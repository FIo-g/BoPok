// 함께 가는 사람과 걷기 조건. 주인: 김태형·김경선. 바꾸면 프론트와 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { nonNegative } from './common'

export const SexSchema = z.enum(['female', 'male'])
export type Sex = z.infer<typeof SexSchema>

// 본인이 답한 걷는 속도. unknown은 '잘 모르겠어요'
export const PaceSchema = z.enum(['slow', 'normal', 'unknown'])
export type Pace = z.infer<typeof PaceSchema>

export const ConditionSchema = z.object({
  continuousMin: nonNegative, // 쉬지 않고 걸을 수 있는 시간
  dayMin: nonNegative, // 하루 총 걷기
  restMin: nonNegative, // 한 번 쉬는 시간
  avoidStairs: z.boolean(),
})
export type Condition = z.infer<typeof ConditionSchema>

export const TravelerSchema = z.object({
  id: z.string(),
  label: z.string().min(1), // 엄마, 아빠, 나 …
  userId: z.string().optional(), // 그룹 구성원 계정과 연결되면
  age: z.number().int().min(0).max(120).optional(),
  heightCm: z.number().min(50).max(250).optional(),
  sex: SexSchema.optional(),
  pace: PaceSchema,
  mobilityAid: z.boolean(), // 지팡이·보행 보조기구
  condition: ConditionSchema.partial(), // 비어 있으면 엔진이 기본값을 쓴다
  filledBySelf: z.boolean(), // 본인이 직접 채웠는지
})
export type Traveler = z.infer<typeof TravelerSchema>
