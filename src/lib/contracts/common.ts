// 공용 기본 타입. 이 파일을 바꾸면 프론트와 관련 담당이 함께 리뷰한다 (AGENTS.md 3장).
// 단위: 거리 m, 시간 분, 속도 m/s. 좌표는 [경도, 위도].
import { z } from 'zod'

export const nonNegative = z.number().min(0)

// [경도, 위도]. 대전은 경도 127·위도 36이라 순서가 뒤바뀌면 위도 범위(±90)에서 걸린다.
export const CoordSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
export type Coord = z.infer<typeof CoordSchema>

// A 공식 안내·현장 확인 / B 지도에서 측정 / C 사진·후기로 추정
export const ConfidenceSchema = z.enum(['A', 'B', 'C'])
export type Confidence = z.infer<typeof ConfidenceSchema>

export const SourceInfoSchema = z.object({
  source: z.string().optional(),
  checkedAt: z.string().optional(), // 'YYYY-MM' 또는 'YYYY-MM-DD'
  confidence: ConfidenceSchema,
})
export type SourceInfo = z.infer<typeof SourceInfoSchema>

// '계단 없음'은 사람이 확인한 confirmed_none일 때만 화면에 쓴다. unknown은 '계단 기록 없음'.
export const StairsStatusSchema = z.enum(['present', 'confirmed_none', 'unknown'])
export type StairsStatus = z.infer<typeof StairsStatusSchema>

export const TransportSchema = z.enum(['walk', 'car', 'taxi', 'bus'])
export type Transport = z.infer<typeof TransportSchema>

export const ApiErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid_request',
  'expired',
  'ai_failed',
  'external_api_failed',
  'internal_error',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// 모든 API의 에러 응답 모양
export const ApiErrorSchema = z.object({
  error: z.object({ code: ApiErrorCodeSchema, message: z.string() }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>
