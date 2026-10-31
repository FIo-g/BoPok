// 함께 가는 사람(여행자) 저장·수정. 담당: 김경선.
// 응답 모양은 src/lib/contracts/traveler.ts(화면이 쓰는 모양)를 그대로 따른다.
import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { PatchTravelerRequest, Traveler } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { groupMembers, tripTravelers, trips } from '@/lib/db/schema'

type TravelerRow = typeof tripTravelers.$inferSelect

// 계약의 age·heightCm·sex·userId는 optional(없음)이고 DB는 null이다 → null을 undefined로 바꾼다.
// null을 그대로 내보내면 화면의 스키마 검사에서 걸린다.
function toTraveler(row: TravelerRow): Traveler {
  return {
    id: row.id,
    label: row.label,
    userId: row.userId ?? undefined,
    age: row.age ?? undefined,
    heightCm: row.heightCm ?? undefined,
    sex: row.sex ?? undefined,
    pace: row.pace,
    mobilityAid: row.mobilityAid,
    isParent: row.isParent,
    condition: row.condition,
    filledBySelf: row.filledBySelf,
  }
}

export async function listTravelers(tripId: string, db: Db = getDb()): Promise<Traveler[]> {
  const rows = await db
    .select()
    .from(tripTravelers)
    .where(eq(tripTravelers.tripId, tripId))
    .orderBy(asc(tripTravelers.sortOrder))
  return rows.map(toTraveler)
}

// 계정 연결·'본인이 직접 채웠는지' 규칙. 화면(오하연 src/lib/plan/travelers.ts, PR #10)과 같은 규칙이고,
// 몸체의 filledBySelf와 userId는 믿지 않는다 — 그러지 않으면 누구나 '부모님이 직접 답했다'고
// 꾸밀 수 있고 판정 근거가 거짓이 된다.

// 본인이 직접 채웠다고 볼 수 있는 칸. 이름표·부모님 여부·계정 연결은 '조건을 말한 것'이 아니라서 뺀다
// (화면의 CONDITION_FIELDS와 같다).
const CONDITION_FIELDS = ['age', 'heightCm', 'sex', 'pace', 'mobilityAid', 'condition'] as const

// 키 순서를 맞춰 비교한다 — condition은 jsonb라 DB에서 키 순서가 바뀌어 돌아온다.
// 순서만 다른 것을 '바뀌었다'로 보면 연결만 해도 filledBySelf가 올라가 버린다.
function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sameValue = (a: unknown, b: unknown) => stable(a) === stable(b)

// 저장할 userId를 정한다. 화면 규칙("내 연결만 걸고 풀 수 있다")을 서버에서도 지킨다.
function resolveUserId(args: {
  incoming: Traveler
  existing?: TravelerRow
  actorUserId?: string
}): string | null {
  const existingUserId = args.existing?.userId ?? null
  const incomingUserId = args.incoming.userId ?? null

  // 저장하는 사람이 없는 길(AI 인터뷰)에서는 연결을 걸거나 풀지 않는다 — '내 연결만' 규칙에
  // 해당하는 '나'가 없기 때문이다. 보내온 연결은 400으로 막지 않고 버리되 로그에 남긴다
  // (일정·여행자 저장 자체를 실패시키면 인터뷰 결과가 통째로 날아간다).
  if (!args.actorUserId) {
    if (incomingUserId !== existingUserId) {
      console.error('[acct] 저장하는 사람이 없어 여행자 계정 연결을 건너뜀', {
        travelerId: args.incoming.id,
        incomingUserId,
      })
    }
    return existingUserId
  }

  if (incomingUserId === existingUserId) return existingUserId

  // 남의 연결은 그 본인만 풀거나 바꿀 수 있다 — 남이 몸체에서 빼도 기존 값을 지킨다.
  if (existingUserId !== null && existingUserId !== args.actorUserId) return existingUserId

  // 새로 거는 연결은 내 계정만.
  if (incomingUserId !== null && incomingUserId !== args.actorUserId) {
    throw new HttpError(400, 'invalid_request', '내 계정만 연결할 수 있어요')
  }
  return incomingUserId
}

// 한 계정은 한 여행에서 한 사람과만 연결된다 (화면 목업과 같은 문구).
function assertOneTravelerPerAccount(userIds: (string | null)[]): void {
  const linked = userIds.filter((id): id is string => id !== null)
  if (new Set(linked).size !== linked.length) {
    throw new HttpError(400, 'invalid_request', '한 계정은 한 사람과만 연결할 수 있어요')
  }
}

// 연결하는 계정은 그 그룹 구성원이어야 한다 — 아니면 그룹 밖 계정을 여행에 끌어올 수 있다.
async function assertLinkedUsersAreMembers(
  args: { groupId: string; userIds: (string | null)[] },
  db: Db,
): Promise<void> {
  const userIds = [...new Set(args.userIds.filter((id): id is string => id !== null))]
  if (userIds.length === 0) return

  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, args.groupId), inArray(groupMembers.userId, userIds)))
  const members = new Set(rows.map(row => row.userId))

  if (userIds.some(id => !members.has(id))) {
    throw new HttpError(400, 'invalid_request', '이 그룹의 구성원이 아닌 계정은 연결할 수 없어요')
  }
}

// 걷기 조건 칸만 모은 모양. PUT(통째로 저장)과 PATCH(한 칸 고치기)가 같은 비교를 쓰게 한다.
type ConditionFields = Pick<Traveler, (typeof CONDITION_FIELDS)[number]>

// 연결된 본인이 걷기 조건을 실제로 바꿨거나 새로 만든 여행자일 때만 true.
// 연결만 하고 조건이 그대로면 기존 값을 유지하고, 한 번 true면 계속 true다
// (화면의 markSelfFilled와 같은 규칙). PUT·PATCH 둘 다 이 함수를 쓴다.
function nextFilledBySelf(args: {
  next: ConditionFields
  existing?: TravelerRow
  userId: string | null
  actorUserId?: string
  selfAnswered?: boolean
}): boolean {
  const was = args.existing?.filledBySelf ?? false
  if (was) return true
  if (args.selfAnswered) return true
  if (!args.actorUserId || args.userId !== args.actorUserId) return was
  if (!args.existing) return true // 새로 만든 여행자
  const existing = args.existing
  return CONDITION_FIELDS.some(field => !sameValue(existing[field], args.next[field])) ? true : was
}

// PUT /api/trips/:id/travelers — 목록을 통째로 바꾼다. 받은 순서를 sort_order에 적어 그대로 돌려준다.
// db.transaction()은 쓸 수 없어서(Neon HTTP) '다 지우고 다시 넣기' 두 문장이다.
// 사이에 서버가 죽으면 여행자가 비는 드문 위험이 있다 — MVP에서는 받아들인다.
export async function replaceTravelers(
  args: {
    tripId: string
    travelers: Traveler[]
    actorUserId?: string
    // AI 인터뷰에서 '만든 사람이 직접 답한' 여행자 id (saveTravelers가 넘긴다)
    selfAnsweredIds?: string[]
  },
  db: Db = getDb(),
): Promise<Traveler[]> {
  const [trip] = await db.select({ groupId: trips.groupId }).from(trips).where(eq(trips.id, args.tripId)).limit(1)
  if (!trip) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')

  // 지금 저장된 모습 — 연결과 filledBySelf를 지키는 기준이 된다 (몸체 값은 믿지 않는다).
  const before = await db.select().from(tripTravelers).where(eq(tripTravelers.tripId, args.tripId))
  const beforeById = new Map(before.map(row => [row.id, row]))
  const selfAnswered = new Set(args.selfAnsweredIds ?? [])

  const rows = args.travelers.map((incoming, index) => {
    const existing = beforeById.get(incoming.id)
    const userId = resolveUserId({ incoming, existing, actorUserId: args.actorUserId })
    return {
      id: incoming.id,
      tripId: args.tripId,
      userId,
      label: incoming.label,
      age: incoming.age ?? null,
      heightCm: incoming.heightCm ?? null,
      sex: incoming.sex ?? null,
      pace: incoming.pace,
      mobilityAid: incoming.mobilityAid,
      isParent: incoming.isParent,
      condition: incoming.condition,
      filledBySelf: nextFilledBySelf({
        next: incoming,
        existing,
        userId,
        actorUserId: args.actorUserId,
        selfAnswered: selfAnswered.has(incoming.id),
      }),
      sortOrder: index,
    }
  })

  const userIds = rows.map(row => row.userId)
  assertOneTravelerPerAccount(userIds)
  await assertLinkedUsersAreMembers({ groupId: trip.groupId, userIds }, db)

  await db.delete(tripTravelers).where(eq(tripTravelers.tripId, args.tripId))
  await db.insert(tripTravelers).values(rows)

  return listTravelers(args.tripId, db)
}

// 김태형의 src/lib/ai/deps.ts가 기다리는 모양 그대로 — 인터뷰가 채운 여행자를 저장한다.
// AI 쪽에는 '고치는 사람'이 없으므로 filledBySelf는 받은 값을 그대로 쓴다.
export async function saveTravelers(tripId: string, travelers: Traveler[]): Promise<void> {
  const db = getDb()
  const [trip] = await db.select({ createdBy: trips.createdBy }).from(trips).where(eq(trips.id, tripId)).limit(1)
  if (!trip) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')

  // 이름표가 '나'인데 계정이 안 붙은 사람은 여행을 만든 사람이다 — 인터뷰에 직접 답한 사람이므로
  // 연결하고 filledBySelf도 true로 본다. 만든 사람이 이미 다른 여행자에 연결돼 있으면 건드리지 않는다.
  const alreadyLinked = travelers.some(one => one.userId === trip.createdBy)
  const me = alreadyLinked ? undefined : travelers.find(one => one.label === '나' && !one.userId)

  const prepared = me ? travelers.map(one => (one.id === me.id ? { ...one, userId: trip.createdBy } : one)) : travelers

  await replaceTravelers(
    {
      tripId,
      travelers: prepared,
      actorUserId: me ? trip.createdBy : undefined,
      selfAnsweredIds: me ? [me.id] : [],
    },
    db,
  )
}

// PATCH /api/trips/:id/travelers/:tid — 보낸 칸만 바꾼다.
// 몸체의 userId와 filledBySelf는 믿지 않는다:
//  - userId는 이 API로 바꿀 수 없다 (계정 연결은 PUT으로 목록을 통째로 저장할 때만)
//  - filledBySelf는 '고치는 사람이 그 여행자와 연결된 본인인지'로 서버가 정한다
// condition은 통째로 바꾼다(합치지 않는다) — 합치면 칸을 비울 방법이 없다.
export async function patchTraveler(
  args: { tripId: string; travelerId: string; patch: PatchTravelerRequest; actorUserId?: string },
  db: Db = getDb(),
): Promise<Traveler> {
  const where = and(eq(tripTravelers.tripId, args.tripId), eq(tripTravelers.id, args.travelerId))
  const [existing] = await db.select().from(tripTravelers).where(where).limit(1)
  if (!existing) throw new HttpError(404, 'not_found', '그 여행자를 찾을 수 없어요')

  const { patch } = args
  // 고친 뒤의 걷기 조건 — PUT과 같은 함수로 '실제로 바뀌었나'를 본다
  const next: ConditionFields = {
    age: 'age' in patch ? patch.age ?? undefined : existing.age ?? undefined,
    heightCm: 'heightCm' in patch ? patch.heightCm ?? undefined : existing.heightCm ?? undefined,
    sex: 'sex' in patch ? patch.sex ?? undefined : existing.sex ?? undefined,
    pace: patch.pace ?? existing.pace,
    mobilityAid: patch.mobilityAid ?? existing.mobilityAid,
    condition: patch.condition ?? existing.condition,
  }

  const [updated] = await db
    .update(tripTravelers)
    .set({
      label: patch.label ?? existing.label,
      age: next.age ?? null,
      heightCm: next.heightCm ?? null,
      sex: next.sex ?? null,
      pace: next.pace,
      mobilityAid: next.mobilityAid,
      isParent: patch.isParent ?? existing.isParent,
      condition: next.condition,
      // userId는 이 API로 바꿀 수 없으므로 기존 연결로 판단한다
      filledBySelf: nextFilledBySelf({ next, existing, userId: existing.userId, actorUserId: args.actorUserId }),
    })
    .where(where)
    .returning()

  return toTraveler(updated)
}
