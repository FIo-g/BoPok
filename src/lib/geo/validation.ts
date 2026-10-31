import 'server-only'
import { z } from 'zod'
import { CoordSchema, LegEndSchema, LegRequestSchema, LegsRequestSchema, LegSchema, PlaceIdInputSchema } from '@/lib/contracts'

export const TMAP_PEDESTRIAN_URL = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1'
export const TMAP_CAR_URL = 'https://apis.openapi.sk.com/tmap/routes?version=1'

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

// 자동차·택시 경로. durationMin은 TMAP 자동차 경로 totalTime(초)을 분으로 바꾼 추정 시간이다.
// 택시 요금(fareKrw)과 계단 정보는 만들지 않는다. 계단은 탈것 구간과 무관해서 unknown으로 둔다.
export const VehicleLegSchema = LegSchema.extend({
  mode: z.enum(['car', 'taxi']), distanceM: z.number().finite().positive(),
  durationMin: z.number().finite().positive(),
  path: z.array(CoordSchema).min(2),
  source: z.literal(TMAP_CAR_URL), checkedAt: z.iso.date(), confidence: z.literal('B'),
  stairsStatus: z.literal('unknown'), stairsCount: z.undefined().optional(), fareKrw: z.undefined().optional(),
})

// 캐시 행은 수단에 맞는 스키마 하나를 통과해야 다시 쓴다. 맞지 않는 행은 삭제하지 않고 미스로 본다.
export const CachedLegSchema = z.union([WalkingLegSchema, VehicleLegSchema])
