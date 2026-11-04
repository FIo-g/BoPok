import { z } from 'zod'
import { CostEstimateSchema, CostItemKindSchema, type CostEstimate } from '@/lib/contracts'

export const CostChargeSchema = z.object({
  stopKey: z.string().nullable(), kind: CostItemKindSchema,
  amountKrw: z.number().int().min(0).max(2000000000),
  quantity: z.number().int().min(1).max(365).default(1),
  unit: z.enum(['per_person', 'shared']),
}).strict()
export const EstimateCostInputSchema = z.object({
  partySize: z.number().int().min(1).max(100),
  charges: z.array(CostChargeSchema).max(500),
  bufferRate: z.number().min(0).max(1).default(0.2),
}).strict()

export function estimateCosts(value: unknown): CostEstimate {
  const input = EstimateCostInputSchema.parse(value)
  const items = input.charges.map(charge => ({
    stopKey: charge.stopKey, kind: charge.kind,
    // 함께 내는 비용은 나눈 뒤 원 단위로 올려 예상액이 작아지지 않게 한다.
    krw: Math.ceil(charge.amountKrw * charge.quantity / (charge.unit === 'shared' ? input.partySize : 1)),
  }))
  const low = items.reduce((sum, item) => sum + item.krw, 0)
  return CostEstimateSchema.parse({ items, bufferRate: input.bufferRate,
    perPersonKrw: { low, high: Math.round(low * (1 + input.bufferRate)) } })
}
