// 여행 만들기·조회·고치기·목록. 담당: 김경선.
// 권한 검사는 여기서 하지 않는다 — route가 access.ts의 requireTripMember로 먼저 막는다.
// 응답 모양은 src/lib/contracts/trip-api.ts(화면이 쓰는 모양)를 그대로 따른다.
import 'server-only'
import { desc, eq } from 'drizzle-orm'
import type { CreateTripRequest, Trip, TripDetail, TripListItem, UpdateTripRequest } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { trips } from '@/lib/db/schema'
import { listTravelers } from './travelers'
import { listVersionSummaries, summariesByTrip } from './versions'

type TripRow = typeof trips.$inferSelect

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    date: row.date, // 'YYYY-MM-DD' 또는 null
    mode: row.startMode,
    transport: row.transport,
    styles: row.styles,
    budget: row.budget,
    confirmedVersionId: row.confirmedVersionId, // 4단계까지는 항상 null
    confirmedByName: null, // 4단계에서 user.name을 이어 붙인다
    createdAt: row.createdAt.toISOString(),
  }
}

export async function createTrip(
  args: CreateTripRequest & { userId: string },
  db: Db = getDb(),
): Promise<Trip> {
  const [row] = await db
    .insert(trips)
    .values({
      groupId: args.groupId,
      title: args.title,
      date: args.date ?? null,
      startMode: args.mode,
      createdBy: args.userId,
    })
    .returning()
  return toTrip(row)
}

async function findTrip(tripId: string, db: Db): Promise<TripRow> {
  const [row] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1)
  // 구성원인지 이미 확인했는데 없다면 그 사이에 지워진 경우뿐이다.
  if (!row) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')
  return row
}

export async function getTrip(tripId: string, db: Db = getDb()): Promise<Trip> {
  return toTrip(await findTrip(tripId, db))
}

// versions는 번호 오름차순이고 stops가 없는 요약이다 (화면은 마지막 것을 '최신'으로 본다).
export async function getTripDetail(tripId: string, db: Db = getDb()): Promise<TripDetail> {
  const row = await findTrip(tripId, db)
  return {
    trip: toTrip(row),
    travelers: await listTravelers(tripId, db),
    versions: await listVersionSummaries(tripId, db),
  }
}

// PATCH — 보낸 칸만 바꾼다. 빈 몸체({})면 지금 값을 그대로 돌려준다.
export async function updateTrip(
  args: { tripId: string; patch: UpdateTripRequest },
  db: Db = getDb(),
): Promise<Trip> {
  const existing = await findTrip(args.tripId, db)
  const { patch } = args
  if (Object.keys(patch).length === 0) return toTrip(existing)

  const [row] = await db
    .update(trips)
    .set({
      title: patch.title ?? existing.title,
      date: 'date' in patch ? patch.date ?? null : existing.date,
      transport: 'transport' in patch ? patch.transport ?? null : existing.transport,
      styles: patch.styles ?? existing.styles,
      budget: 'budget' in patch ? patch.budget ?? null : existing.budget,
    })
    .where(eq(trips.id, args.tripId))
    .returning()
  return toTrip(row)
}

// GET /api/groups/:id/trips — 여행마다 최신 버전과 확정 버전 요약을 붙인다.
// 요약은 한 번에 가져와 묶는다 (여행마다 묻지 않으려고).
export async function listGroupTrips(groupId: string, db: Db = getDb()): Promise<TripListItem[]> {
  const rows = await db.select().from(trips).where(eq(trips.groupId, groupId)).orderBy(desc(trips.createdAt))
  const byTrip = await summariesByTrip(
    rows.map(row => row.id),
    db,
  )

  return rows.map(row => {
    const versions = byTrip.get(row.id) ?? []
    // 번호 오름차순이므로 마지막이 최신이다 (목업 mock-api.ts와 같은 규칙).
    const latestVersion = versions.at(-1) ?? null
    // 확정은 5단계에서 채운다 — confirmed_version_id가 null인 동안은 이 값도 null이다.
    const confirmedVersion = versions.find(one => one.id === row.confirmedVersionId) ?? null
    return { trip: toTrip(row), latestVersion, confirmedVersion }
  })
}
