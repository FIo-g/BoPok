// 여행자 건강 정보(병·약 종류, 보이는 범위, 동의)의 저장·읽기·지우기. 담당: 김태형 (설계 4.4).
//
// 개인정보 규칙 (src/lib/contracts/health.ts 머리말과 같다):
// - 병·약·보이는 범위 값은 로그와 에러 메시지에 넣지 않는다. 남겨도 되는 것은 tripId·travelerId·건수뿐이다.
// - 누가 보는지는 canSeeHealth, 누가 고치는지는 canEditHealth가 정한다. 그 함수들의 세 번째 인자는
//   `traveler.userId ?? null`로 넘긴다 (생략과 "계정 없음"을 헷갈리지 않으려고 꼭 받게 했다).
import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { FoodTag, Traveler, TravelerHealth, TravelerHealthInput } from '@/lib/contracts'
import { canEditHealth, canSeeHealth } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripTravelerHealth } from '@/lib/db/schema'
import { AI_AVOID_RULES, avoidFoodTags } from '@/lib/engine'
import { listTravelers } from '@/lib/trips/travelers'

export { deleteHealthExcept, deleteHealthFor } from './prune'

type HealthRow = typeof tripTravelerHealth.$inferSelect

// DB 행 → 계약 모양. consentAt은 시간대가 붙은 시각이라 ISO 문자열(Z)로 되돌린다.
function toHealth(row: HealthRow): TravelerHealth {
  return {
    tripId: row.tripId,
    travelerId: row.travelerId,
    conditions: row.conditions,
    medicationClasses: row.medicationClasses,
    visibility: row.visibility,
    consentAt: row.consentAt.toISOString(),
    enteredByUserId: row.enteredByUserId,
  }
}

async function findHealthRow(tripId: string, travelerId: string, db: Db): Promise<HealthRow | undefined> {
  const [row] = await db
    .select()
    .from(tripTravelerHealth)
    .where(and(eq(tripTravelerHealth.tripId, tripId), eq(tripTravelerHealth.travelerId, travelerId)))
    .limit(1)
  return row
}

// 지금 여행자 목록에 있는 사람의 건강 정보만, 여행자 순서대로 돌려준다.
// 목록에서 빠진 사람의 남은 기록은 (deleteHealthExcept가 지우기 전이라도) 돌려주지 않는다.
async function listHealthOfCurrentTravelers(
  tripId: string,
  db: Db,
): Promise<{ traveler: Traveler; health: TravelerHealth }[]> {
  const travelers = await listTravelers(tripId, db)
  const rows = await db.select().from(tripTravelerHealth).where(eq(tripTravelerHealth.tripId, tripId))
  const rowByTravelerId = new Map(rows.map(row => [row.travelerId, row]))

  const found: { traveler: Traveler; health: TravelerHealth }[] = []
  for (const traveler of travelers) {
    const row = rowByTravelerId.get(traveler.id)
    if (row) found.push({ traveler, health: toHealth(row) })
  }
  return found
}

// 보는 사람(viewerUserId)이 볼 수 있는 건강 정보만 돌려준다. 이 그룹의 구성원인지는 route가 먼저 검사한다.
// 주의: 식단 주의(dietCautions)는 반드시 이 함수가 거른 결과만 받아야 한다. 걸러지지 않은 전체를 넘기면
// "본인만"으로 해 둔 병·약 이름이 다른 가족의 화면에 주의 문구로 드러난다.
// (AI에 넘기는 음식 태그는 이유가 빠져 있어서 avoidFoodTagsForTrip이 일행 전체를 쓴다 — 아래 참고.)
export async function listVisibleHealth(
  tripId: string,
  viewerUserId: string,
  db: Db = getDb(),
): Promise<TravelerHealth[]> {
  const all = await listHealthOfCurrentTravelers(tripId, db)
  return all
    .filter(({ traveler, health }) => canSeeHealth(health, viewerUserId, traveler.userId ?? null))
    .map(({ health }) => health)
}

// 고치기·지우기 전에 여행자와 지금 저장된 기록을 찾고 권한을 검사한다. 실패하면 HttpError를 던진다.
// 메시지에는 건강 정보를 넣지 않는다.
async function loadForEdit(
  args: { tripId: string; travelerId: string; actorUserId: string },
  db: Db,
): Promise<HealthRow | undefined> {
  const travelers = await listTravelers(args.tripId, db)
  const traveler = travelers.find(one => one.id === args.travelerId)
  if (!traveler) throw new HttpError(404, 'not_found', '그 여행자를 찾을 수 없어요')

  const existing = await findHealthRow(args.tripId, args.travelerId, db)
  if (!canEditHealth(existing ?? null, args.actorUserId, traveler.userId ?? null)) {
    throw new HttpError(403, 'forbidden', '이 건강 정보는 고칠 수 없어요')
  }
  return existing
}

// 저장(처음 넣기·고치기). 동의 날짜는 서버가 찍고, 처음 입력한 사람(enteredByUserId)은 바꾸지 않는다.
// 동의(consent: true) 검사는 route가 스키마로 하고, 여기서는 받은 input을 믿는다.
// db.transaction()을 쓸 수 없어(Neon HTTP) 읽고 → 권한을 보고 → upsert 순서다.
export async function putHealth(
  args: { tripId: string; travelerId: string; actorUserId: string; input: TravelerHealthInput },
  db: Db = getDb(),
): Promise<TravelerHealth> {
  await loadForEdit(args, db)

  const values = {
    conditions: args.input.conditions,
    medicationClasses: args.input.medicationClasses,
    visibility: args.input.visibility,
    consentAt: new Date(),
  }
  // 충돌했을 때 갱신하는 칸에 enteredByUserId를 넣지 않는 것이 "첫 입력자 유지"다.
  try {
    const [row] = await db
      .insert(tripTravelerHealth)
      .values({ tripId: args.tripId, travelerId: args.travelerId, enteredByUserId: args.actorUserId, ...values })
      .onConflictDoUpdate({ target: [tripTravelerHealth.tripId, tripTravelerHealth.travelerId], set: values })
      .returning()
    return toHealth(row)
  } catch (error) {
    throw scrubbedWriteError(error, args)
  }
}

// drizzle은 쿼리가 실패하면 메시지에 "Failed query: … params: …"로 SQL 인자(병·약 값)를 담고 원래 오류를 cause로 붙인다.
// route의 errorResponse가 그 메시지를 서버 로그에 그대로 찍으므로, 값이 든 오류는 새 Error로 바꿔 던진다.
// cause를 일부러 붙이지 않는다 (붙이면 원래 메시지가 다시 로그로 나간다). 남기는 것은 tripId·travelerId뿐이다.
function scrubbedWriteError(error: unknown, args: { tripId: string; travelerId: string }): Error {
  if (error instanceof HttpError) return error
  console.error('[health] 저장 실패', { tripId: args.tripId, travelerId: args.travelerId })
  return new Error('건강 정보를 저장하지 못했어요')
}

// 지우기 = 동의 철회. 바로 삭제한다. 기록이 없으면 아무것도 하지 않고 끝난다.
export async function deleteHealth(
  args: { tripId: string; travelerId: string; actorUserId: string },
  db: Db = getDb(),
): Promise<void> {
  const existing = await loadForEdit(args, db)
  if (!existing) return
  await db
    .delete(tripTravelerHealth)
    .where(and(eq(tripTravelerHealth.tripId, args.tripId), eq(tripTravelerHealth.travelerId, args.travelerId)))
}

// AI에 넘길 "피할 음식 태그". 보이는 범위(visibility)와 상관없이 일행 전체의 병·약으로 모은다.
// 일부러 거르지 않는 까닭: AI에는 누가 왜인지가 가지 않고 음식 태그만 가기 때문이다.
// 반대로 화면에 띄우는 주의 문구는 이유가 붙으므로 listVisibleHealth의 결과만 써야 한다.
export async function avoidFoodTagsForTrip(tripId: string, db: Db = getDb()): Promise<FoodTag[]> {
  const all = await listHealthOfCurrentTravelers(tripId, db)
  return avoidFoodTags(
    all.map(({ health }) => health),
    AI_AVOID_RULES, // 근거가 "피하라"가 아닌 규칙(와파린 잎채소)은 뺀 표
  )
}
