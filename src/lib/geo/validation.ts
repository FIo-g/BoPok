import 'server-only'
import { z } from 'zod'
import { CoordSchema, LegEndSchema, LegRequestSchema, LegsRequestSchema, LegSchema, PlaceIdInputSchema } from '@/lib/contracts'

export const TMAP_PEDESTRIAN_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1'

const EndInputSchema = LegEndSchema.extend({
  placeId: PlaceIdInputSchema.optional(), nodeId: PlaceIdInputSchema.optional(),
}).strict()
export const LegInputSchema = LegRequestSchema.extend({ from: EndInputSchema, to: EndInputSchema }).strict()
export const LegsInputSchema = LegsRequestSchema.extend({ requests: z.array(LegInputSchema).max(20) }).strict()

// 이 구현이 확인한 보행 경로만 캐시에 재사용한다. 이전 실험 값은 삭제하지 않고 캐시 미스로 본다.
export const WalkingLegSchema = LegSchema.extend({
  mode: z.literal('walk'), distanceM: z.number().finite().positive(),
  path: z.array(CoordSchema).min(2),
  source: z.literal(TMAP_PEDESTRIAN_URL), checkedAt: z.iso.date(), confidence: z.literal('B'),
  stairsStatus: z.literal('unknown'), stairsCount: z.undefined().optional(),
  durationMin: z.undefined().optional(), fareKrw: z.undefined().optional(),
})
