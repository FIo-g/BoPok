// 판정 입력과 결과. 주인: 김태형. 바꾸면 프론트·김경선과 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { nonNegative, SourceInfoSchema, StairsStatusSchema, TransportSchema } from './common'
import { LegSchema } from './leg'
import { PlaceDetailSchema } from './place'
import { StopSchema } from './trip'
import { ConditionFieldSchema, ConditionSchema, TravelerSchema } from './traveler'

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

// 조건 칸마다 값이 어디서 왔는지. 화면에 "부모님 기준" 같은 근거로 보여준다 (설계 7.1.1)
export const ConditionSourceSchema = z.enum(['parent', 'blend', 'other', 'default', 'tuned'])
export type ConditionSource = z.infer<typeof ConditionSourceSchema>

export const ConditionFromSchema = z.object({
  continuousMin: ConditionSourceSchema,
  dayMin: ConditionSourceSchema,
  restMin: ConditionSourceSchema,
  avoidStairs: ConditionSourceSchema,
})
export type ConditionFrom = z.infer<typeof ConditionFromSchema>

// 부모님 확인이 필요한 칸. 값은 분(숫자) 또는 계단 피하기(참/거짓) (설계 7.1.3)
export const PendingConsentSchema = z.object({
  field: ConditionFieldSchema,
  parentTravelerId: z.string(),
  proposedValue: z.union([nonNegative, z.boolean()]),
  fromTravelerId: z.string(), // 이 값을 제안한 사람
  askCreator: z.boolean(), // 계정이 없는 부모님이면 여행 만든 사람에게 대신 묻는다
})
export type PendingConsent = z.infer<typeof PendingConsentSchema>

// 받지 못했거나 만들 수 없는 장소 사이 경로. legKey가 null이면 좌표가 없어 경로를 만들 수 없다
export const MissingLegSchema = z.object({
  fromStopKey: z.string(),
  toStopKey: z.string(),
  legKey: z.string().nullable(),
})
export type MissingLeg = z.infer<typeof MissingLegSchema>

const SegmentStatusSchema = z.enum(['ok', 'warn'])

export const SegmentResultSchema = SourceInfoSchema.extend({
  segmentId: z.string(),
  label: z.string(),
  time: MinutesSchema,
  reverse: z.boolean(), // 주차장·정류장으로 돌아가는 길처럼 같은 구간을 거꾸로 걷는 줄
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
  condition: ConditionSchema, // 실제로 쓴 조건 (부모님 80% 비중의 일행 조건 + 조건 바꿔 보기, 설계 7.1.1)
  conditionFrom: ConditionFromSchema, // 조건 칸마다 값의 출처
  speedMps: z.number().positive(), // 실제로 쓴 속도 (가장 느린 사람 기준)
  speedTravelerId: z.string(), // 속도 기준이 된 여행자
  pendingConsents: z.array(PendingConsentSchema), // 부모님 확인이 필요한 칸
  day: MinutesSchema,
  // 걷는 구간이 없으면 장소 키는 null
  longest: MinutesSchema.extend({ fromStopKey: z.string().nullable(), toStopKey: z.string().nullable() }),
  restTotalMin: nonNegative,
  stops: z.array(StopResultSchema),
  legs: z.array(LegResultSchema),
  violations: z.array(ViolationSchema),
  unknownStopKeys: z.array(z.string()), // 장소 안 정보가 없는 곳
  // '계단 기록 없음' 구간. 계단 피하기일 때 배지 아래 "기록 없는 구간 n곳"으로 보여준다
  unrecordedStairs: z.array(z.object({ segmentId: z.string().optional(), legKey: z.string().optional() })),
  missingLegs: z.array(MissingLegSchema), // 받지 못했거나 만들 수 없는 장소 사이 경로
})
export type JudgeResult = z.infer<typeof JudgeResultSchema>

// 버전에 저장하는 요약 (목록 표시용)
export const JudgeSummarySchema = JudgeResultSchema.pick({ verdict: true, reason: true, day: true, longest: true })
export type JudgeSummary = z.infer<typeof JudgeSummarySchema>

// 빠른 수정안 한 단계에서 바꾼 것 (설계 7.4). 화면 문장은 fixedChangeSentence가 만든다.
export const QuickFixChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('detour'),
    stopKey: z.string(),
    segmentId: z.string(),
    detourSegmentId: z.string(),
  }),
  z.object({ kind: z.literal('skip'), stopKey: z.string(), segmentId: z.string() }),
  z.object({ kind: z.literal('rest'), stopKey: z.string(), nodeId: z.string() }),
  z.object({ kind: z.literal('taxi'), toStopKey: z.string() }),
])
export type QuickFixChange = z.infer<typeof QuickFixChangeSchema>

// A 동선 조정 → B 휴식 추가 → C 이동수단 변경. 적용하면 새 버전이 된다.
export const QuickFixSchema = z.object({
  level: z.enum(['A', 'B', 'C']),
  stops: z.array(StopSchema),
  result: JudgeResultSchema,
  enough: z.boolean(), // 위반이 모두 사라졌는지
  changes: z.array(QuickFixChangeSchema),
})
export type QuickFix = z.infer<typeof QuickFixSchema>

// 버전 비교 카드. 바뀐 항목만 이 순서대로 담는다.
export const DiffItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verdict'), before: VerdictSchema, after: VerdictSchema }),
  z.object({
    kind: z.literal('stairs'),
    before: z.number().int().min(0),
    after: z.number().int().min(0),
  }),
  z.object({ kind: z.literal('longest'), before: MinutesSchema, after: MinutesSchema }),
  z.object({ kind: z.literal('day'), before: MinutesSchema, after: MinutesSchema }),
  z.object({ kind: z.literal('restTotal'), before: nonNegative, after: nonNegative }),
])
export type DiffItem = z.infer<typeof DiffItemSchema>
