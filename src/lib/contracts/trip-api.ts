// 여행 API의 요청·응답 모양. 주인: 김경선. 화면(오하연)이 필요해서 추가한 초안 — 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
// 일정 한 장소(Stop)는 trip.ts, 버전 전체는 version.ts에 있다. 여기는 그것을 둘러싼 여행 단위 모양이다.
import { z } from 'zod'
import { BudgetSchema, StartModeSchema, TravelStyleSchema } from './ai'
import { LegRequestSchema, LegSchema } from './leg'
import { PlaceDetailSchema } from './place'
import { TravelerSchema } from './traveler'
import { StopSchema } from './trip'
import { TripVersionSchema } from './version'

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다')

// 인터뷰의 이동수단 답(InterviewFilled.transport)과 같은 3가지
export const TripTransportSchema = z.enum(['car', 'transit', 'taxi'])
export type TripTransport = z.infer<typeof TripTransportSchema>

export const TripSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  title: z.string().min(1).max(60),
  date: DateSchema.nullish(),
  mode: StartModeSchema, // paste 붙여넣기 / scratch 처음부터
  transport: TripTransportSchema.nullish(),
  styles: z.array(TravelStyleSchema),
  budget: BudgetSchema.nullish(),
  confirmedVersionId: z.string().nullable(), // 확정은 여행당 한 버전. null이면 작성 중
  confirmedByName: z.string().nullish(), // 누가 확정했는지
  createdAt: z.string(),
})
export type Trip = z.infer<typeof TripSchema>

// 버전 목록·여행 목록에서 쓰는 요약(stops 없음). madeByName은 '누가 만들었는지'를 화면에 보여 주려고 서버가 채운다
export const VersionSummarySchema = TripVersionSchema.omit({ stops: true }).extend({
  madeByName: z.string().nullish(),
})
export type VersionSummary = z.infer<typeof VersionSummarySchema>

// GET /api/trips/:id
export const TripDetailSchema = z.object({
  trip: TripSchema,
  travelers: z.array(TravelerSchema),
  versions: z.array(VersionSummarySchema),
})
export type TripDetail = z.infer<typeof TripDetailSchema>

// GET /api/groups/:id/trips — 여행마다 최신 버전과 확정 버전 요약
export const TripListItemSchema = z.object({
  trip: TripSchema,
  latestVersion: VersionSummarySchema.nullable(),
  confirmedVersion: VersionSummarySchema.nullable(),
})
export type TripListItem = z.infer<typeof TripListItemSchema>

// POST /api/trips
export const CreateTripRequestSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().trim().min(1).max(60),
  date: DateSchema.nullish(),
  mode: StartModeSchema,
})
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>

// PATCH /api/trips/:id — 바꿀 칸만 보낸다
export const UpdateTripRequestSchema = z.object({
  title: z.string().trim().min(1).max(60),
  date: DateSchema.nullable(),
  transport: TripTransportSchema.nullable(),
  styles: z.array(TravelStyleSchema),
  budget: BudgetSchema.nullable(),
}).partial()
export type UpdateTripRequest = z.infer<typeof UpdateTripRequestSchema>

// PUT /api/trips/:id/travelers — 여행자 목록 통째로
export const PutTravelersRequestSchema = z.object({ travelers: z.array(TravelerSchema).min(1) })
export type PutTravelersRequest = z.infer<typeof PutTravelersRequestSchema>

// PATCH /api/trips/:id/travelers/:tid — 바꿀 칸만 보낸다 (id는 주소로 받으므로 몸체에서 뺀다).
// 화면(api-client)이 쓰는 Partial<Omit<Traveler, 'id'>>와 같은 모양이다. 3단계에서 더함 — 김경선.
// 단, 서버는 이 몸체의 userId와 filledBySelf를 무시한다:
//  - userId(계정 연결)는 PUT /api/trips/:id/travelers로 목록을 통째로 저장할 때만 바꿀 수 있다
//  - filledBySelf는 '고치는 사람이 그 여행자 본인인지'로 서버가 정한다 (판정 근거를 꾸밀 수 없게)
export const PatchTravelerRequestSchema = TravelerSchema.omit({ id: true }).partial()
export type PatchTravelerRequest = z.infer<typeof PatchTravelerRequestSchema>

// POST /api/trips/:id/versions — 직접 고친 일정, 빠른 수정안 저장
export const SaveVersionRequestSchema = z.object({
  parentId: z.string().nullable(),
  stops: z.array(StopSchema),
  madeBy: z.enum(['user', 'quick_fix']),
  note: z.string().max(200).nullish(),
})
export type SaveVersionRequest = z.infer<typeof SaveVersionRequestSchema>

// POST /api/trips/:id/confirm
export const ConfirmRequestSchema = z.object({ versionId: z.string().min(1) })
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>

// GET /api/trips/:id/share-text
export const ShareTextResponseSchema = z.object({ text: z.string() })
export type ShareTextResponse = z.infer<typeof ShareTextResponseSchema>

// 장소·경로 API (이동주). POST /api/places/details, POST /api/legs
export const PlaceDetailsRequestSchema = z.object({ ids: z.array(z.string()) })
export type PlaceDetailsRequest = z.infer<typeof PlaceDetailsRequestSchema>
export const PlaceDetailsResponseSchema = z.array(PlaceDetailSchema)
export const LegsRequestSchema = z.object({ requests: z.array(LegRequestSchema) })
export type LegsRequest = z.infer<typeof LegsRequestSchema>
export const LegsResponseSchema = z.array(LegSchema)
