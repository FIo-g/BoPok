// 장소 데이터. 주인: 이동주. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { CoordSchema, nonNegative, SourceInfoSchema, StairsStatusSchema } from './common'

export const PlaceNodeKindSchema = z.enum(['parking', 'stop', 'entrance', 'sight', 'exit', 'rest', 'toilet'])
export type PlaceNodeKind = z.infer<typeof PlaceNodeKindSchema>

export const PlaceNodeSchema = z.object({
  id: z.string(),
  placeId: z.string(),
  kind: PlaceNodeKindSchema,
  name: z.string(),
  restType: z.enum(['indoor', 'outdoor']).nullable(),
  coord: CoordSchema,
})
export type PlaceNode = z.infer<typeof PlaceNodeSchema>

export const PlaceSegmentSchema = SourceInfoSchema.extend({
  id: z.string(),
  placeId: z.string(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  order: z.number().int().min(0),
  distanceM: nonNegative,
  path: z.array(CoordSchema).min(2),
  stairsStatus: StairsStatusSchema,
  stairsCount: z.number().int().min(0).optional(),
  slope: z.boolean(),
  optional: z.boolean(), // 꼭 보지 않아도 되는 구간 (수정안 A에서 뺄 수 있음)
  detourOf: z.string().optional(), // 이 구간이 어떤 계단 구간의 우회로인지
})
export type PlaceSegment = z.infer<typeof PlaceSegmentSchema>

export const PlaceSummarySchema = SourceInfoSchema.extend({
  id: z.string(),
  name: z.string().min(1),
  category: z.string(),
  styles: z.array(z.string()),
  coord: CoordSchema,
  visitMin: nonNegative.optional(), // 홈페이지 기준 머무는 시간
  seated: z.boolean(), // 식사·카페·족욕처럼 앉아서 머무는 곳 → 연속 걷기가 끊긴다
  indoor: z.boolean(),
  address: z.string().optional(),
  phone: z.string().optional(),
  homepage: z.string().optional(),
})
export type PlaceSummary = z.infer<typeof PlaceSummarySchema>

export const PlaceDetailSchema = PlaceSummarySchema.extend({
  nodes: z.array(PlaceNodeSchema),
  segments: z.array(PlaceSegmentSchema),
})
export type PlaceDetail = z.infer<typeof PlaceDetailSchema>
// 프론트가 쓰는 기존 응답 모양을 유지하고, 서버 입력도 같은 계약에서 검사한다.
export const PlaceIdInputSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
export const PlaceListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  styles: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
}).strict()
export type PlaceListQuery = z.infer<typeof PlaceListQuerySchema>
export const PlaceSummaryListSchema = z.array(PlaceSummarySchema)
