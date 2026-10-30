// AI API의 요청·응답 계약. 5~7단계(인터뷰, 붙여넣기, 일정, 다시 짜기, 설명)가 모두 이 파일을 쓴다 (설계 6장).
// 주인: 김태형. 바꾸면 프론트·김경선·이동주와 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { ApiErrorCodeSchema } from './common'
import { JudgeResultSchema, JudgeSummarySchema, QuickFixChangeSchema } from './judge'
import { StopSchema, TimeSchema } from './trip'
import { TravelerSchema } from './traveler'
import { TripVersionSchema } from './version'

// AI 실패 시 화면이 돌아갈 대체 동작 (설계 6.4: A는 직접 고르기, B는 다시 시도+직접 고르기)
export const AiFallbackSchema = z.enum(['pick_places', 'retry_or_pick', 'fixed_text'])
export type AiFallback = z.infer<typeof AiFallbackSchema>

// AI 실패 응답: ApiErrorSchema 모양 + fallback
export const AiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    fallback: AiFallbackSchema.optional(),
  }),
})
export type AiError = z.infer<typeof AiErrorSchema>

// 1인당 하루 예산 (설계 6.3)
export const BudgetSchema = z.enum(['under_30k', '30k_50k', '50k_100k', 'over_100k'])
export type Budget = z.infer<typeof BudgetSchema>

// A 붙여넣기 / B 처음부터
export const StartModeSchema = z.enum(['paste', 'scratch'])
export type StartMode = z.infer<typeof StartModeSchema>

// 고정 목록 + '기타' 직접 입력이라 스키마는 문자열로 받는다 (설계 6.3)
export const TravelStyleSchema = z.string().min(1).max(30)
export type TravelStyle = z.infer<typeof TravelStyleSchema>

// 인터뷰가 채우는 칸 목록. 순서·이름은 설계 6.3과 5단계가 쓴다
export const INTERVIEW_SLOTS = [
  'travelers',
  'traveler_age',
  'traveler_height',
  'traveler_sex',
  'traveler_condition_gate',
  'traveler_condition',
  'date',
  'time',
  'transport',
  'styles',
  'budget',
  'must_visit',
  'fix_target',
  'done',
] as const
export type InterviewSlot = (typeof INTERVIEW_SLOTS)[number]
export const InterviewSlotSchema = z.enum(INTERVIEW_SLOTS)

export const InterviewAnswerSchema = z
  .object({
    choiceIndex: z.number().int().min(0).optional(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional(),
  })
  .refine(a => a.choiceIndex !== undefined || a.text !== undefined, {
    message: '선택이나 글 중 하나는 있어야 합니다',
  })
export type InterviewAnswer = z.infer<typeof InterviewAnswerSchema>

export const MustVisitSchema = z.object({
  name: z.string().min(1),
  reservedAt: TimeSchema.optional(),
})
export type MustVisit = z.infer<typeof MustVisitSchema>

// 정규식만으로는 2026-99-99 같은 없는 날짜를 걸러내지 못한다 — 실제 달력을 확인한다.
// 객체 전체가 아니라 문자열 칸에 refine을 건다 (zod 4에서는 객체 refine이 있으면 extend·pick이 막힌다)
function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}

// 인터뷰가 채운 칸. 이동수단은 인터뷰 답(3가지)이고 Stop.arriveBy는 7.3.1 규칙으로 정한다
export const InterviewFilledSchema = z.object({
  mode: StartModeSchema,
  travelers: z.array(TravelerSchema),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, { message: '없는 날짜예요' })
    .optional(),
  startTime: TimeSchema.optional(),
  endTime: TimeSchema.optional(),
  transport: z.enum(['car', 'transit', 'taxi']).optional(),
  styles: z.array(TravelStyleSchema),
  budget: BudgetSchema.optional(),
  mustVisit: z.array(MustVisitSchema),
  fixTargets: z.array(z.string().min(1)),
  pastedText: z.string().max(5000).optional(),
})
export type InterviewFilled = z.infer<typeof InterviewFilledSchema>

// trip_interviews에 저장할 모양 (컬럼은 김경선 trips 스키마와 맞춘다)
export const InterviewStateSchema = z.object({
  filled: InterviewFilledSchema,
  cursor: z.object({
    slot: InterviewSlotSchema,
    travelerIndex: z.number().int().min(0),
    questionIndex: z.number().int().min(0),
  }),
  history: z.array(z.object({ role: z.enum(['assistant', 'user']), text: z.string() })),
})
export type InterviewState = z.infer<typeof InterviewStateSchema>

export const InterviewRequestSchema = z.object({
  tripId: z.string().min(1),
  // 받은 질문 표시. 지금 질문과 다르면 서버는 답을 적용하지 않고 같은 질문을 다시 돌려준다
  // (같은 답이 두 번 와도 칸을 건너뛰지 않게)
  questionId: z.string().min(1).optional(),
  answer: InterviewAnswerSchema.optional(),
})
export type InterviewRequest = z.infer<typeof InterviewRequestSchema>

export const InterviewResponseSchema = z.object({
  text: z.string(),
  choices: z.array(z.string()),
  slot: InterviewSlotSchema,
  done: z.boolean(),
  filled: InterviewFilledSchema,
  // 화면이 보낸 답이 어느 질문에 대한 것인지 맞추는 표시 — `${slot}:${travelerIndex}:${questionIndex}`
  questionId: z.string().min(1),
})
export type InterviewResponse = z.infer<typeof InterviewResponseSchema>

export const ParseScheduleRequestSchema = z.object({
  tripId: z.string().min(1),
  text: z
    .string()
    .trim()
    .min(1)
    .max(5000),
})
export type ParseScheduleRequest = z.infer<typeof ParseScheduleRequestSchema>

export const ParseScheduleResponseSchema = z.object({
  stops: z.array(StopSchema),
  unmatched: z.array(z.string()),
})
export type ParseScheduleResponse = z.infer<typeof ParseScheduleResponseSchema>

export const GenerateRequestSchema = z.object({
  tripId: z.string().min(1),
})
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>

// 처음부터 일정·다시 짜기의 공통 응답
export const PlanResponseSchema = z.object({
  version: TripVersionSchema,
  summary: JudgeSummarySchema,
})
export type PlanResponse = z.infer<typeof PlanResponseSchema>

export const ReviseRequestSchema = z.object({
  tripId: z.string().min(1),
  versionId: z.string().min(1),
})
export type ReviseRequest = z.infer<typeof ReviseRequestSchema>

export const ReviseResponseSchema = PlanResponseSchema.extend({ appliedOpinionIds: z.array(z.string()) })
export type ReviseResponse = z.infer<typeof ReviseResponseSchema>

// 바뀐 점 한 줄은 요청에 온 판정 결과로 만든 문장이라 화면에만 보여 주고 저장하지 않는다
// (prev·next·changes의 숫자를 그대로 믿고 새 숫자를 만들지 않는다)
export const ExplainRequestSchema = z.object({
  tripId: z.string().min(1),
  prev: JudgeResultSchema,
  next: JudgeResultSchema,
  changes: z.array(QuickFixChangeSchema).optional(),
})
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>

export const ExplainResponseSchema = z.object({
  text: z.string(),
  source: z.enum(['ai', 'fixed']),
})
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>
