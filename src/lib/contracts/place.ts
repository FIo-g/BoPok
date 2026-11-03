// 장소 데이터. 주인: 이동주. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { CoordSchema, nonNegative, SourceInfoSchema, StairsStatusSchema } from './common'

// 장소 종류. kind가 없는 기존 장소는 관광지로 본다 (placeKindOf).
export const PlaceKindSchema = z.enum(['attraction', 'restaurant', 'cafe', 'lodging'])
export type PlaceKind = z.infer<typeof PlaceKindSchema>

// 흡연장은 넣지 않는다 — 건강을 위한 서비스라 안내하지 않는다 [결정: 김태형 11/2]
export const PlaceNodeKindSchema = z.enum(['parking', 'stop', 'entrance', 'sight', 'exit', 'rest', 'toilet'])
export type PlaceNodeKind = z.infer<typeof PlaceNodeKindSchema>

export const PlaceNodeSchema = z.object({
  id: z.string(),
  placeId: z.string(),
  kind: PlaceNodeKindSchema,
  name: z.string(),
  restType: z.enum(['indoor', 'outdoor']).nullable(),
  coord: CoordSchema,
  floor: z.number().int().optional(), // 1=1층, -1=지하 1층
  guideNo: z.number().int().min(1).optional(), // 현장 안내도에 적힌 번호
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
  courseId: z.string().optional(), // 이 구간이 속한 관람 코스 (PlaceCourse.id)
})
export type PlaceSegment = z.infer<typeof PlaceSegmentSchema>

// 장소 안 관람 코스 (예: 동원·서원). 어느 코스가 부모님께 맞는지 근거와 함께 담는다.
export const PlaceCourseSchema = SourceInfoSchema.extend({
  id: z.string(),
  name: z.string().min(1),
  recommended: z.boolean(),
})
export type PlaceCourse = z.infer<typeof PlaceCourseSchema>

// 층별 구역. 꼭짓점이 3개 미만이면 면이 되지 않아 거부한다. 장소 데이터라 출처·확인 날짜·신뢰 등급을 붙인다 (AGENTS 6장).
export const PlaceZoneSchema = SourceInfoSchema.extend({
  id: z.string(),
  name: z.string().min(1),
  floor: z.number().int(),
  polygon: z.array(CoordSchema).min(3),
})
export type PlaceZone = z.infer<typeof PlaceZoneSchema>

// 지도 위에 올리는 3D 건물 모형. scale이 0이면 보이지 않으므로 0보다 커야 한다.
// 보기 전용 자산이라 판정·엔진이 읽지 않아 출처 칸을 두지 않는다.
export const PlaceModelSchema = z.object({
  url: z.string().min(1),
  anchor: CoordSchema,
  rotationDeg: z.number().min(-360).max(360),
  scale: z.number().gt(0),
  altitudeM: z.number(),
})
export type PlaceModel = z.infer<typeof PlaceModelSchema>

// 음식 주의 태그. 주의 규칙 표(DietRule)와 함께 늘린다.
export const FoodTagSchema = z.enum(['sugary', 'salty', 'fatty', 'alcohol', 'grapefruit', 'leafy_greens'])
export type FoodTag = z.infer<typeof FoodTagSchema>

// 화면·주의 문구에 쓰는 이름
export const FOOD_TAG_LABEL: Record<FoodTag, string> = {
  sugary: '단 음식',
  salty: '짠 음식',
  fatty: '기름진 음식',
  alcohol: '술',
  grapefruit: '자몽',
  leafy_greens: '녹색 잎채소',
}

export const MenuItemSchema = SourceInfoSchema.extend({
  name: z.string().min(1),
  priceKrw: z.number().int().min(0).optional(),
  foodTags: z.array(FoodTagSchema),
})
export type MenuItem = z.infer<typeof MenuItemSchema>

export const PlaceSummarySchema = SourceInfoSchema.extend({
  id: z.string(),
  name: z.string().min(1),
  category: z.string(),
  kind: PlaceKindSchema.optional(), // 없으면 관광지 (placeKindOf)
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

// .default()를 쓰면 출력 타입이 필수가 되어 기존 코드가 깨지므로, 기본값은 이 함수가 정한다.
export function placeKindOf(place: Pick<PlaceSummary, 'kind'>): PlaceKind {
  return place.kind ?? 'attraction'
}

export const PlaceDetailSchema = PlaceSummarySchema.extend({
  nodes: z.array(PlaceNodeSchema),
  segments: z.array(PlaceSegmentSchema),
  // 아래 칸은 목록 응답이 커지지 않도록 상세에만 둔다.
  courses: z.array(PlaceCourseSchema).optional(),
  zones: z.array(PlaceZoneSchema).optional(),
  model: PlaceModelSchema.optional(),
  menus: z.array(MenuItemSchema).optional(),
  research: z.object({ candidateCount: z.number().int().positive(), continuousWheelchairAccess: z.literal('unverified'), notice: z.string() }).optional(),
})
export type PlaceDetail = z.infer<typeof PlaceDetailSchema>
// 프론트가 쓰는 기존 응답 모양을 유지하고, 서버 입력도 같은 계약에서 검사한다.
export const PlaceIdInputSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
export const PlaceListQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  styles: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  kind: PlaceKindSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()
export type PlaceListQuery = z.infer<typeof PlaceListQuerySchema>
export const PlaceSummaryListSchema = z.array(PlaceSummarySchema)
