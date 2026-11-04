import { z } from 'zod'
import { CoordSchema } from './common'
import { MenuItemSchema, PlaceKindSchema, PlaceSummarySchema } from './place'

export const PlaceRecommendationRequestSchema = z.object({
  kind: PlaceKindSchema,
  query: z.string().trim().max(100).default(''),
  near: CoordSchema.optional(),
  route: z.tuple([CoordSchema, CoordSchema]).optional(),
  limit: z.number().int().min(1).max(20).default(10),
  avoidStairs: z.boolean().optional(),
}).strict()
export type PlaceRecommendationRequest = z.infer<typeof PlaceRecommendationRequestSchema>

export const PlaceRecommendationResponseSchema = z.object({
  catalogReady: z.boolean(),
  method: z.enum(['vector', 'keyword']),
  distanceBasis: z.literal('straight_line'),
  routeCheckRequired: z.literal(true),
  items: z.array(z.object({
    place: PlaceSummarySchema,
    menus: z.array(MenuItemSchema),
    distanceM: z.number().int().nonnegative().optional(),
    straightLineDetourM: z.number().int().nonnegative().optional(),
  })),
})
export type PlaceRecommendationResponse = z.infer<typeof PlaceRecommendationResponseSchema>
