// 장소 사이 경로. 주인: 이동주. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { CoordSchema, nonNegative, SourceInfoSchema, StairsStatusSchema, TransportSchema } from './common'

export const LegEndSchema = z.object({
  placeId: z.string().optional(),
  nodeId: z.string().optional(),
  coord: CoordSchema,
})
export type LegEnd = z.infer<typeof LegEndSchema>

export const LegRequestSchema = z.object({
  from: LegEndSchema,
  to: LegEndSchema,
  mode: TransportSchema,
})
export type LegRequest = z.infer<typeof LegRequestSchema>

export const LegSchema = SourceInfoSchema.extend({
  key: z.string(), // legKey(요청)
  mode: TransportSchema,
  distanceM: nonNegative,
  durationMin: nonNegative.optional(), // 탈것만
  path: z.array(CoordSchema),
  stairsStatus: StairsStatusSchema,
  stairsCount: z.number().int().min(0).optional(),
  fareKrw: nonNegative.optional(), // 택시 추정 요금
})
export type Leg = z.infer<typeof LegSchema>

function endKey(end: LegEnd): string {
  if (end.placeId && end.nodeId) return `${end.placeId}/${end.nodeId}`
  // 소수점 5자리(약 1 m)로 반올림해서 같은 지점이 다른 키가 되지 않게 한다 (경로 캐시).
  const [lng, lat] = end.coord
  return `${lng.toFixed(5)},${lat.toFixed(5)}`
}

// 프론트·엔진·서버가 같은 경로를 같은 키로 찾도록 한 곳에서 만든다.
export function legKey(req: LegRequest): string {
  return `${endKey(req.from)}>${endKey(req.to)}:${req.mode}`
}
