// 일정 버전 저장·조회. 담당: 김경선.
// POST /api/trips/:id/versions(화면)과 createVersion(AI)이 같은 저장 함수를 쓴다.
import 'server-only'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { SaveVersionRequest, Stop, TripVersion, VersionSummary } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripVersions, user } from '@/lib/db/schema'

type VersionRow = typeof tripVersions.$inferSelect

function toVersion(row: VersionRow): TripVersion {
  return {
    id: row.id,
    tripId: row.tripId,
    number: row.number,
    parentId: row.parentId,
    madeBy: row.madeBy,
    madeByUserId: row.madeByUserId,
    stops: row.stops,
    summary: row.judgeSummary, // 엔진 연결은 6단계라 지금은 null
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

// 버전 목록·여행 목록에서 쓰는 요약 — stops를 뺀 것 + 누가 만들었는지(madeByName).
// 목업(src/mocks/mock-api.ts의 summaryOf)과 같은 모양이다.
function toSummary(row: VersionRow & { madeByName: string | null }): VersionSummary {
  const { stops: _stops, ...rest } = toVersion(row)
  void _stops
  return { ...rest, madeByName: row.madeByName }
}

// 번호가 겹쳐 들어갈 때 DB가 내는 오류(23505)인지 본다. 드라이버가 오류를 한 겹 감싸므로
// cause까지 따라 들어가 확인한다.
function isDuplicateNumber(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown }
    if (candidate.code === '23505') return true
    if (typeof candidate.message === 'string' && candidate.message.includes('trip_versions_trip_number_unique')) {
      return true
    }
    current = candidate.cause
  }
  return false
}

const MAX_TRIES = 5

type SaveInput = {
  tripId: string
  parentId: string | null
  stops: Stop[]
  madeBy: TripVersion['madeBy']
  madeByUserId?: string | null
  note?: string | null
}

// 번호는 여행마다 1, 2, 3…. db.transaction()을 못 쓰므로(Neon HTTP) '세어서 넣고,
// 겹치면 다시 시도'한다. 겹침은 (trip_id, number) 유니크 제약이 DB에서 막아 준다.
async function insertWithNextNumber(input: SaveInput, db: Db): Promise<VersionRow> {
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const [counted] = await db
      .select({ last: sql<number>`coalesce(max(${tripVersions.number}), 0)` })
      .from(tripVersions)
      .where(eq(tripVersions.tripId, input.tripId))

    try {
      const [row] = await db
        .insert(tripVersions)
        .values({
          tripId: input.tripId,
          number: Number(counted.last) + 1,
          parentId: input.parentId,
          madeBy: input.madeBy,
          madeByUserId: input.madeByUserId ?? null,
          stops: input.stops,
          judgeSummary: null, // 6단계에서 채운다
          note: input.note ?? null,
        })
        .returning()
      return row
    } catch (error) {
      // 다른 사람이 같은 번호를 먼저 넣었다 → 다시 세어서 시도한다
      if (!isDuplicateNumber(error)) throw error
    }
  }
  throw new HttpError(500, 'internal_error', '버전을 저장하지 못했어요. 잠시 후 다시 시도해 주세요')
}

// parentId는 같은 여행의 버전이어야 한다 — 다른 여행 버전 id로 족보를 이을 수 없게.
// 목업과 같은 코드·문구를 쓴다 (mock-api.ts의 saveVersion).
async function assertParentInTrip(args: { tripId: string; parentId: string | null }, db: Db): Promise<void> {
  if (!args.parentId) return
  const [parent] = await db
    .select({ id: tripVersions.id })
    .from(tripVersions)
    .where(and(eq(tripVersions.id, args.parentId), eq(tripVersions.tripId, args.tripId)))
    .limit(1)
  if (!parent) throw new HttpError(400, 'invalid_request', '이전 버전을 찾을 수 없어요')
}

async function save(input: SaveInput, db: Db): Promise<TripVersion> {
  await assertParentInTrip({ tripId: input.tripId, parentId: input.parentId }, db)
  return toVersion(await insertWithNextNumber(input, db))
}

// POST /api/trips/:id/versions — 직접 고친 일정·빠른 수정안 (madeBy는 user 또는 quick_fix)
export async function saveVersion(
  args: { tripId: string; input: SaveVersionRequest; userId: string },
  db: Db = getDb(),
): Promise<TripVersion> {
  return save(
    {
      tripId: args.tripId,
      parentId: args.input.parentId,
      stops: args.input.stops,
      madeBy: args.input.madeBy,
      madeByUserId: args.userId,
      note: args.input.note,
    },
    db,
  )
}

// 김태형의 src/lib/ai/deps.ts가 기다리는 모양 그대로 — AI가 짠 일정을 저장한다.
// appliedOpinionIds는 5단계(의견 API)에서 연결한다. 지금은 의견을 만드는 길이 없어 항상 빈 배열이다.
export async function createVersion(
  tripId: string,
  input: {
    parentId: string | null
    stops: Stop[]
    madeBy: 'ai'
    madeByUserId?: string
    note?: string
    appliedOpinionIds?: string[]
  },
): Promise<TripVersion> {
  return save(
    {
      tripId,
      parentId: input.parentId,
      stops: input.stops,
      madeBy: input.madeBy,
      madeByUserId: input.madeByUserId,
      note: input.note,
    },
    getDb(),
  )
}

// GET /api/trips/:id/versions/:vid — 그 여행의 버전이 아니면 404 (목업과 같은 문구)
export async function getVersion(
  args: { tripId: string; versionId: string },
  db: Db = getDb(),
): Promise<TripVersion> {
  const [row] = await db
    .select()
    .from(tripVersions)
    .where(and(eq(tripVersions.id, args.versionId), eq(tripVersions.tripId, args.tripId)))
    .limit(1)
  if (!row) throw new HttpError(404, 'not_found', '버전을 찾을 수 없어요')
  return toVersion(row)
}

// 버전 전체(stops 포함) — AI가 쓰는 getTripContext용
export async function listVersions(tripId: string, db: Db = getDb()): Promise<TripVersion[]> {
  const rows = await db
    .select()
    .from(tripVersions)
    .where(eq(tripVersions.tripId, tripId))
    .orderBy(asc(tripVersions.number))
  return rows.map(toVersion)
}

// 요약 목록(번호 오름차순). 화면은 마지막 것을 '최신'으로 본다 (목업 versionsOf와 같다).
export async function listVersionSummaries(tripId: string, db: Db = getDb()): Promise<VersionSummary[]> {
  return (await selectSummaries([tripId], db)).get(tripId) ?? []
}

// 여행 여러 개의 요약을 한 번에 — 여행 목록에서 여행마다 묻지 않으려고(N+1 방지).
export async function summariesByTrip(tripIds: string[], db: Db = getDb()): Promise<Map<string, VersionSummary[]>> {
  return selectSummaries(tripIds, db)
}

async function selectSummaries(tripIds: string[], db: Db): Promise<Map<string, VersionSummary[]>> {
  const byTrip = new Map<string, VersionSummary[]>()
  if (tripIds.length === 0) return byTrip

  const rows = await db
    .select({ version: tripVersions, madeByName: user.name })
    .from(tripVersions)
    .leftJoin(user, eq(user.id, tripVersions.madeByUserId))
    .where(inArray(tripVersions.tripId, tripIds))
    .orderBy(asc(tripVersions.number))

  for (const row of rows) {
    const summary = toSummary({ ...row.version, madeByName: row.madeByName })
    const list = byTrip.get(summary.tripId)
    if (list) list.push(summary)
    else byTrip.set(summary.tripId, [summary])
  }
  return byTrip
}
