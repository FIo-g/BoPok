import { z } from 'zod'
import { LegEndSchema, LegRequestSchema } from './leg'
import { PlaceIdInputSchema } from './place'

// 택시 요금은 등록된 장소에서만 낸다. placeId 형식을 계약에서 막아 잘못된 ID가 외부 경로 호출까지 가지 않게 한다.
const TaxiEndSchema = LegEndSchema.extend({ placeId: PlaceIdInputSchema })

export const TaxiCostRequestSchema = z.object({ requests: z.array(LegRequestSchema.extend({
  from: TaxiEndSchema,
  to: TaxiEndSchema,
  mode: z.literal('taxi'),
})).max(20) }).strict()
export type TaxiCostRequest = z.infer<typeof TaxiCostRequestSchema>

export const TaxiCostResponseSchema = z.array(z.object({
  key: z.string(), distanceM: z.number().finite().nonnegative(), fareKrw: z.number().int().nonnegative(),
  basis: z.literal('distance_only'), source: z.url(), checkedAt: z.string(), exclusions: z.array(z.string()),
}))
export type TaxiCostResponse = z.infer<typeof TaxiCostResponseSchema>
