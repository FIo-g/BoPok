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

// '본인이 직접 채웠는지'는 서버가 정한다 (역할 문서 규칙). 몸체에 뭐가 와도 믿지 않는다 —
// 그러지 않으면 누구나 '부모님이 직접 답했다'고 꾸밀 수 있고, 판정 근거가 거짓이 된다.
function isSelf(travelerUserId: string | null | undefined, actorUserId: string | undefined): boolean {
  return Boolean(actorUserId && travelerUserId && travelerUserId === actorUserId)
}

// 여행자에 계정을 연결할 때는 그 사람이 그 그룹 구성원이어야 한다 —
// 아니면 그룹 밖 계정 id를 넣어 남의 이름을 여행에 끌어올 수 있다.
async function assertLinkedUsersAreMembers(
  args: { groupId: string; travelers: Traveler[] },
  db: Db,
): Promise<void> {
  const userIds = [...new Set(args.travelers.map(one => one.userId).filter((id): id is string => Boolean(id)))]
  if (userIds.length === 0) return

  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, args.groupId), inArray(groupMembers.userId, userIds)))
  const members = new Set(rows.map(row => row.userId))

  if (userIds.some(id => !members.has(id))) {
    throw new HttpError(400, 'invalid_request', '그룹 구성원이 아닌 계정은 여행자와 연결할 수 없어요')
  }
}

// PUT /api/trips/:id/travelers — 목록을 통째로 바꾼다. 받은 순서를 sort_order에 적어 그대로 돌려준다.
// db.transaction()은 쓸 수 없어서(Neon HTTP) '다 지우고 다시 넣기' 두 문장이다.
// 사이에 서버가 죽으면 여행자가 비는 드문 위험이 있다 — MVP에서는 받아들인다.
export async function replaceTravelers(
  args: { tripId: string; travelers: Traveler[]; actorUserId?: string },
  db: Db = getDb(),
): Promise<Traveler[]> {
  const [trip] = await db.select({ groupId: trips.groupId }).from(trips).where(eq(trips.id, args.tripId)).limit(1)
  if (!trip) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')

  await assertLinkedUsersAreMembers({ groupId: trip.groupId, travelers: args.travelers }, db)

  // 이미 있던 여행자의 filledBySelf를 기억해 둔다 — 몸체 값은 믿지 않는다.
  // 규칙: 저장하는 사람이 그 여행자와 연결된 본인이면 true, 아니면 기존 값을 그대로 둔다
  // (새 여행자는 false). 화면의 여행자 편집은 PATCH가 아니라 PUT만 쓰기 때문에,
  // 부모님이 자기 계정으로 자기 칸을 저장하는 길이 여기여야 한다.
  const before = await db
    .select({ id: tripTravelers.id, filledBySelf: tripTravelers.filledBySelf })
    .from(tripTravelers)
    .where(eq(tripTravelers.tripId, args.tripId))
  const wasFilledBySelf = new Map(before.map(row => [row.id, row.filledBySelf]))

  await db.delete(tripTravelers).where(eq(tripTravelers.tripId, args.tripId))

  await db.insert(tripTravelers).values(
    args.travelers.map((traveler, index) => ({
      id: traveler.id,
      tripId: args.tripId,
      userId: traveler.userId ?? null,
      label: traveler.label,
      age: traveler.age ?? null,
      heightCm: traveler.heightCm ?? null,
      sex: traveler.sex ?? null,
      pace: traveler.pace,
      mobilityAid: traveler.mobilityAid,
      isParent: traveler.isParent,
      condition: traveler.condition,
      filledBySelf: isSelf(traveler.userId, args.actorUserId) || (wasFilledBySelf.get(traveler.id) ?? false),
      sortOrder: index,
    })),
  )

  return listTravelers(args.tripId, db)
}

// 김태형의 src/lib/ai/deps.ts가 기다리는 모양 그대로 — 인터뷰가 채운 여행자를 저장한다.
// AI 쪽에는 '고치는 사람'이 없으므로 filledBySelf는 받은 값을 그대로 쓴다.
export async function saveTravelers(tripId: string, travelers: Traveler[]): Promise<void> {
  await replaceTravelers({ tripId, travelers })
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
  const [updated] = await db
    .update(tripTravelers)
    .set({
      label: patch.label ?? existing.label,
      age: 'age' in patch ? patch.age ?? null : existing.age,
      heightCm: 'heightCm' in patch ? patch.heightCm ?? null : existing.heightCm,
      sex: 'sex' in patch ? patch.sex ?? null : existing.sex,
      pace: patch.pace ?? existing.pace,
      mobilityAid: patch.mobilityAid ?? existing.mobilityAid,
      isParent: patch.isParent ?? existing.isParent,
      condition: patch.condition ?? existing.condition,
      filledBySelf: isSelf(existing.userId, args.actorUserId),
    })
    .where(where)
    .returning()

  return toTraveler(updated)
}
