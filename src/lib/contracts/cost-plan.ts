import { z } from 'zod'
import { CostItemKindSchema } from './cost'
import { ConfidenceSchema } from './common'
import type { Stop } from './trip'

export const CostDraftSchema = z.object({
  amount: z.string().max(10).regex(/^$|^\d+$/).refine(value => value === '' || Number(value) <= 2000000000),
  unit: z.enum(['', 'per_person', 'shared']),
  quantity: z.number().int().min(1).max(365),
  kind: CostItemKindSchema,
  option: z.string().max(500),
  source: z.string().max(2000).optional(),
  checkedAt: z.string().max(40).optional(),
  confidence: ConfidenceSchema.optional(),
}).strict()
export type CostDraft = z.infer<typeof CostDraftSchema>
export const CostDaySchema = z.coerce.number().int().min(1).max(365)
const CostDraftEntrySchema = z.object({ key: z.string().min(1).max(16000), value: CostDraftSchema }).strict()
const CostPlanFieldsSchema = z.object({
  day: CostDaySchema,
  context: z.string().min(1).max(200000),
  baseRevision: z.number().int().positive().nullable(),
  extraCount: z.number().int().min(0).max(30),
  drafts: z.array(CostDraftEntrySchema).max(500),
}).strict()
export const SaveCostPlanSchema = CostPlanFieldsSchema.refine(input => new Set(input.drafts.map(item => item.key)).size === input.drafts.length,
  { message: '같은 비용 항목을 중복 저장할 수 없어요', path: ['drafts'] })
export type SaveCostPlan = z.infer<typeof SaveCostPlanSchema>
export const SavedCostPlanSchema = CostPlanFieldsSchema.omit({ baseRevision: true }).extend({
  tripId: z.string(), versionId: z.string(), partySize: z.number().int().min(1).max(100),
  revision: z.number().int().positive(), updatedByUserId: z.string(), updatedByName: z.string(),
  updatedAt: z.string().datetime(),
})
export type SavedCostPlan = z.infer<typeof SavedCostPlanSchema>
export const CostPlanResponseSchema = z.object({ available: z.boolean(), context: z.string(), plan: SavedCostPlanSchema.nullable() })
export type CostPlanResponse = z.infer<typeof CostPlanResponseSchema>

export function costScope(tripId: string, versionId: string | null, day: number): string {
  return JSON.stringify([tripId, versionId, day])
}
function stopIdentity(stop: Stop) { return [stop.key, stop.placeId, stop.coord ?? null, stop.placeId ? null : stop.name] }
export function placeCostKey(scope: string, stop: Stop): string { return JSON.stringify([scope, 'place', stopIdentity(stop)]) }
export function taxiCostKey(scope: string, from: Stop, to: Stop, partySize: number): string {
  return JSON.stringify([scope, 'taxi', stopIdentity(from), stopIdentity(to), partySize,
    from.skipSegmentIds, from.detourMap, from.restNodeIds, to.skipSegmentIds, to.detourMap, to.restNodeIds])
}
// JSONB는 객체 키 순서를 바꿀 수 있어, 일정 편집 여부는 키를 정렬한 동선 정보로 비교한다.
export function costPlanContext(stops: Stop[], partySize: number): string {
  return JSON.stringify([partySize, stops.map(stop => [stopIdentity(stop), stop.arriveBy,
    [...stop.skipSegmentIds].sort(), Object.entries(stop.detourMap).sort(([a], [b]) => a.localeCompare(b)), [...stop.restNodeIds].sort()])])
}
