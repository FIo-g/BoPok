import { z } from 'zod'
import { LegRequestSchema } from './leg'

export const TaxiCostRequestSchema = z.object({ requests: z.array(LegRequestSchema.extend({
  mode: z.literal('taxi'),
}).refine(request => !!request.from.placeId && !!request.to.placeId, '등록된 대전 장소가 필요합니다.')).max(20) }).strict()
export const TaxiCostResponseSchema = z.array(z.object({
  key: z.string(), distanceM: z.number().finite().nonnegative(), fareKrw: z.number().int().nonnegative(),
  basis: z.literal('distance_only'), source: z.url(), checkedAt: z.string(), exclusions: z.array(z.string()),
}))
