// 함께 가는 사람과 걷기 조건. 주인: 김태형·김경선. 바꾸면 프론트와 함께 리뷰 (AGENTS.md 3장).
import { z } from 'zod'
import { nonNegative } from './common'

export const SexSchema = z.enum(['female', 'male'])
export type Sex = z.infer<typeof SexSchema>

// 본인이 답한 걷는 속도. unknown은 '잘 모르겠어요'
export const PaceSchema = z.enum(['slow', 'normal', 'unknown'])
export type Pace = z.infer<typeof PaceSchema>

// 일주일에 운동하는 횟수. 칩 4개로 고른다 (인터뷰 `traveler_exercise`, 여행자 편집)
export const ExerciseFrequencySchema = z.enum(['rarely', 'one_two', 'three_four', 'five_plus'])
export type ExerciseFrequency = z.infer<typeof ExerciseFrequencySchema>

// 칩 하나만 봐도 뜻이 통하게 "일주일에"를 모두 붙인다
export const EXERCISE_FREQUENCY_LABEL: Record<ExerciseFrequency, string> = {
  rarely: '거의 안 해요',
  one_two: '일주일에 1~2번',
  three_four: '일주일에 3~4번',
  five_plus: '일주일에 5번 이상',
}

export const ConditionSchema = z.object({
  continuousMin: nonNegative, // 쉬지 않고 걸을 수 있는 시간
  dayMin: nonNegative, // 하루 총 걷기
  restMin: nonNegative, // 한 번 쉬는 시간
  avoidStairs: z.boolean(),
})
export type Condition = z.infer<typeof ConditionSchema>

// 조건 칸 이름. 판정 결과의 조건 출처·부모님 확인이 이 이름을 쓴다.
export const ConditionFieldSchema = ConditionSchema.keyof()
export type ConditionField = z.infer<typeof ConditionFieldSchema>

export const TravelerSchema = z.object({
  id: z.string(),
  label: z.string().min(1), // 엄마, 아빠, 나 …
  userId: z.string().optional(), // 그룹 구성원 계정과 연결되면
  age: z.number().int().min(0).max(120).optional(),
  heightCm: z.number().min(50).max(250).optional(),
  sex: SexSchema.optional(),
  pace: PaceSchema,
  mobilityAid: z.boolean(), // 지팡이·보행 보조기구
  isParent: z.boolean(), // 부모님(모시고 가는 분). 걷기 조건에 80% 비중 (설계 7.1.1)
  condition: ConditionSchema.partial(), // 비어 있으면 엔진이 기본값을 쓴다
  filledBySelf: z.boolean(), // 본인이 직접 채웠는지
  // 근거를 찾기 전까지 판정 숫자에는 쓰지 않고 AI가 일정을 짤 때 참고만 한다 (설계 6.2).
  // optional인 까닭: 이 칸이 생기기 전에 저장된 여행자와 '잘 모르겠어요'(비움)도 그대로 통과해야 한다.
  exerciseFrequency: ExerciseFrequencySchema.optional(),
})
export type Traveler = z.infer<typeof TravelerSchema>
