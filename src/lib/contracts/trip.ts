// 일정의 한 장소. 주인: 김경선. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { CoordSchema, nonNegative, TransportSchema } from './common'

export const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm 형식이어야 합니다')

export const StopSchema = z.object({
  key: z.string(), // 버전 안에서 고유. 의견이 여기에 붙는다
  placeId: z.string().nullable(), // null이면 DB에 없는 장소 (정보 없음)
  name: z.string().min(1),
  coord: CoordSchema.optional(),
  startTime: TimeSchema.optional(),
  visitMin: nonNegative.optional(),
  seated: z.boolean().optional(), // placeId가 null일 때 직접 표시 (예: 점심)
  mustVisit: z.boolean(),
  reservedAt: TimeSchema.optional(),
  arriveBy: TransportSchema, // 이전 장소에서 여기로 오는 방법 (첫 장소는 출발 지점 선택에 씀)
  skipSegmentIds: z.array(z.string()),
  detourMap: z.record(z.string(), z.string()), // 계단 구간 id → 우회로 구간 id
  restNodeIds: z.array(z.string()), // 쉬기로 한 쉼터
})
export type Stop = z.infer<typeof StopSchema>
