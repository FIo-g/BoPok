// 판정 입력과 결과. 주인: 김태형. 바꾸면 프론트·김경선과 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { nonNegative, SourceInfoSchema, StairsStatusSchema, TransportSchema } from './common'
import { LegSchema } from './leg'
import { PlaceDetailSchema } from './place'
import { StopSchema } from './trip'
import { ConditionSchema, TravelerSchema } from './traveler'

// 걷는 시간 범위 [base, high] (분). 조건과 비교할 때는 high를 쓴다.
export const MinutesSchema = z.object({ base: nonNegative, high: nonNegative })
export type Minutes = z.infer<typeof MinutesSchema>

export const VerdictSchema = z.enum(['ok', 'adjust', 'info']) // 조건 충족 / 조정 필요 / 정보 부족
export type Verdict = z.infer<typeof VerdictSchema>

export const ViolationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('stairs'),
    stopKey: z.string().nullable(), // 장소 사이 경로면 null
    segmentId: z.string().optional(),
    legKey: z.string().optional(),
    count: z.number().int().min(0).optional(),
  }),
  z.object({ kind: z.literal('continuous'), fromStopKey: z.string(), toStopKey: z.string(), over: nonNegative }),
  z.object({ kind: z.literal('day'), over: nonNegative }),
])
export type Violation = z.infer<typeof ViolationSchema>

const SegmentStatusSchema = z.enum(['ok', 'warn'])

export const SegmentResultSchema = SourceInfoSchema.extend({
  segmentId: z.string(),
  label: z.string(),
  time: MinutesSchema,
  stairsStatus: StairsStatusSchema,
  stairsCount: z.number().int().min(0).optional(),
  status: SegmentStatusSchema,
})
export type SegmentResult = z.infer<typeof SegmentResultSchema>

export const StopResultSchema = z.object({
  stopKey: z.string(),
  placeId: z.string().nullable(),
  known: z.boolean(), // 장소 안 길 정보가 있는지
  walk: MinutesSchema,
  segments: z.array(SegmentResultSchema),
})
export type StopResult = z.infer<typeof StopResultSchema>

export const LegResultSchema = z.object({
  legKey: z.string(),
  fromStopKey: z.string(),
  toStopKey: z.string(),
  mode: TransportSchema,
  walkTime: MinutesSchema.nullable(), // 걷기가 아니면 null
  rideMin: nonNegative.nullable(), // 탈것이 아니면 null
  stairsStatus: StairsStatusSchema,
  status: SegmentStatusSchema,
})
export type LegResult = z.infer<typeof LegResultSchema>

export const JudgeInputSchema = z.object({
  travelers: z.array(TravelerSchema).min(1),
  tuned: ConditionSchema.partial().optional(), // '조건 바꿔 보기'로 덮어쓴 값
  stops: z.array(StopSchema),
  places: z.record(z.string(), PlaceDetailSchema), // placeId → 상세
  legs: z.record(z.string(), LegSchema), // legKey → 경로
})
export type JudgeInput = z.infer<typeof JudgeInputSchema>

export const JudgeResultSchema = z.object({
  verdict: VerdictSchema,
  reason: z.string(), // 판정 이유 한 문장 (계산 결과로 만든 고정 문장, AI 아님)
  condition: ConditionSchema, // 실제로 쓴 조건 (가장 엄격한 사람 기준 + 조건 바꿔 보기)
  speedMps: z.number().positive(), // 실제로 쓴 속도 (가장 느린 사람 기준)
  day: MinutesSchema,
  longest: MinutesSchema.extend({ fromStopKey: z.string(), toStopKey: z.string() }),
  restTotalMin: nonNegative,
  stops: z.array(StopResultSchema),
  legs: z.array(LegResultSchema),
  violations: z.array(ViolationSchema),
  unknownStopKeys: z.array(z.string()), // 장소 안 정보가 없는 곳
  // '계단 기록 없음' 구간. 계단 피하기일 때 배지 아래 "기록 없는 구간 n곳"으로 보여준다
  unrecordedStairs: z.array(z.object({ segmentId: z.string().optional(), legKey: z.string().optional() })),
})
export type JudgeResult = z.infer<typeof JudgeResultSchema>

// 버전에 저장하는 요약 (목록 표시용)
export const JudgeSummarySchema = JudgeResultSchema.pick({ verdict: true, reason: true, day: true, longest: true })
export type JudgeSummary = z.infer<typeof JudgeSummarySchema>
