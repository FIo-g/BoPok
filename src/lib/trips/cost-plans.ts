import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { HttpError } from '@/lib/auth/http'
import { getDb, type Db } from '@/lib/db/client'
import { trips, user, versionCostPlans } from '@/lib/db/schema'
import { costPlanContext, costScope, placeCostKey, taxiCostKey, SaveCostPlanSchema, type SaveCostPlan, type SavedCostPlan } from '@/lib/contracts'
import { stopsOfDay } from '@/lib/contracts'
import { tripDayList } from '@/lib/plan/trip-days'
import { getVersion } from './versions'
import { getTrip } from './trips'
import { listTravelers } from './travelers'

type Scope = { tripId: string; versionId: string; day: number }
async function contextOf(scope: Scope, db: Db) {
  const [trip, version, travelers] = await Promise.all([
    getTrip(scope.tripId, db), getVersion({ tripId: scope.tripId, versionId: scope.versionId }, db), listTravelers(scope.tripId, db),
  ])
  if (!tripDayList(trip, version.stops).includes(scope.day)) throw new HttpError(400, 'invalid_request', '없는 날이에요')
  const stops = stopsOfDay(version.stops, scope.day)
  return { stops, partySize: travelers.length, context: costPlanContext(stops, travelers.length) }
}
async function available(db: Db): Promise<boolean> {
  // 새 코드가 SQL보다 먼저 배포돼도 기존 비용 계산은 계속 제공한다.
  const [result] = await db.select({ ready: sql<boolean>`to_regclass('public.version_cost_plans') is not null` }).from(trips).limit(1)
  return result?.ready ?? false
}
function saved(scope: Scope, row: typeof versionCostPlans.$inferSelect, name: string): SavedCostPlan {
  return { ...scope, partySize: row.partySize, context: row.context, drafts: row.drafts, extraCount: row.extraCount,
    revision: row.revision, updatedByUserId: row.updatedByUserId, updatedByName: name, updatedAt: row.updatedAt.toISOString() }
}
export async function getCostPlan(scope: Scope, db: Db = getDb()) {
  const current = await contextOf(scope, db)
  if (!await available(db)) return { available: false, context: current.context, plan: null }
  const [row] = await db.select({ plan: versionCostPlans, name: user.name }).from(versionCostPlans)
    .innerJoin(user, eq(user.id, versionCostPlans.updatedByUserId))
    .where(and(eq(versionCostPlans.versionId, scope.versionId), eq(versionCostPlans.day, scope.day))).limit(1)
  return { available: true, context: current.context, plan: row ? saved(scope, row.plan, row.name) : null }
}
export async function saveCostPlan(scope: Omit<Scope, 'day'>, inputValue: SaveCostPlan,
  author: { userId: string; userName: string }, db: Db = getDb()) {
  const input = SaveCostPlanSchema.parse(inputValue)
  const fullScope = { ...scope, day: input.day }
  const current = await contextOf(fullScope, db)
  if (current.partySize < 1 || current.partySize > 100) throw new HttpError(400, 'invalid_request', '함께 가는 사람을 먼저 확인해 주세요')
  if (input.context !== current.context) throw new HttpError(409, 'invalid_request', '일정이나 일행이 바뀌었어요. 일정을 먼저 저장하고 비용을 다시 확인해 주세요')
  const prefix = costScope(scope.tripId, scope.versionId, input.day)
  const allowed = new Map(current.stops.map(stop => [placeCostKey(prefix, stop), false]))
  current.stops.forEach((stop, index) => {
    if (index && stop.arriveBy === 'taxi') allowed.set(taxiCostKey(prefix, current.stops[index - 1], stop, current.partySize), true)
  })
  for (let i = 0; i < input.extraCount; i++) allowed.set(`${prefix}:extra-${i}`, false)
  if (input.drafts.some(item => !allowed.has(item.key) || (allowed.get(item.key) && item.value.kind !== 'taxi'))) {
    throw new HttpError(400, 'invalid_request', '이 일정에 없는 비용 항목이에요')
  }
  if (!await available(db)) throw new HttpError(503, 'internal_error', '비용 저장 기능을 준비 중이에요. 지금은 화면에서만 계산할 수 있어요')
  const values = { partySize: current.partySize, context: current.context, drafts: input.drafts,
    extraCount: input.extraCount, updatedByUserId: author.userId, updatedAt: new Date() }
  // 한 SQL의 조건부 갱신으로 다른 가족이 먼저 저장한 금액을 덮어쓰지 않는다.
  const [row] = input.baseRevision === null
    ? await db.insert(versionCostPlans).values({ ...values, versionId: scope.versionId, day: input.day, revision: 1 })
      .onConflictDoNothing().returning()
    : await db.update(versionCostPlans).set({ ...values, revision: input.baseRevision + 1 })
      .where(and(eq(versionCostPlans.versionId, scope.versionId), eq(versionCostPlans.day, input.day), eq(versionCostPlans.revision, input.baseRevision))).returning()
  if (!row) throw new HttpError(409, 'invalid_request', '다른 가족이 먼저 비용을 저장했어요. 저장된 비용을 다시 불러온 뒤 확인해 주세요')
  return { available: true, context: current.context, plan: saved(fullScope, row, author.userName) }
}
