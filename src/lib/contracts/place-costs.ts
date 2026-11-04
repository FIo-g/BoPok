import { z } from 'zod'
import { ConfidenceSchema } from './common'
import { CostItemKindSchema } from './cost'
import { PlaceIdInputSchema } from './place'

export const PlaceCostChoicesRequestSchema = z.object({ ids: z.array(PlaceIdInputSchema).max(100) }).strict()
export const PlaceCostOptionSchema = z.object({
  id: z.string(), label: z.string(), kind: CostItemKindSchema,
  amountKrw: z.number().int().nonnegative(), unit: z.enum(['per_person', 'shared', 'unspecified']),
  source: z.url(), checkedAt: z.string().min(1), confidence: ConfidenceSchema,
})
export const PlaceCostChoicesResponseSchema = z.array(z.object({
  placeId: PlaceIdInputSchema, options: z.array(PlaceCostOptionSchema), notes: z.array(z.string()),
}))
export type PlaceCostOption = z.infer<typeof PlaceCostOptionSchema>
export type PlaceCostChoices = z.infer<typeof PlaceCostChoicesResponseSchema>
