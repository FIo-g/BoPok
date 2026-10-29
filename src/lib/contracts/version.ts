// 일정 버전과 의견. 주인: 김경선. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
// trip.ts와 나눈 이유: 버전은 판정 요약(judge.ts)을, 판정 입력은 Stop(trip.ts)을 써서 한 파일이면 순환 import가 된다.
import { z } from 'zod'
import { JudgeSummarySchema } from './judge'
import { StopSchema } from './trip'

export const TripVersionSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  number: z.number().int().min(1),
  parentId: z.string().nullable(),
  madeBy: z.enum(['user', 'ai', 'quick_fix']),
  madeByUserId: z.string().optional(),
  stops: z.array(StopSchema),
  summary: JudgeSummarySchema.optional(),
  note: z.string().optional(),
  createdAt: z.string(),
})
export type TripVersion = z.infer<typeof TripVersionSchema>

// 너무 멀어요 / 계단이 걱정돼요 / 꼭 가고 싶어요 / 쉬는 곳이 더 있었으면 / 다른 곳이 좋겠어요
export const ReactionSchema = z.enum(['too_far', 'stairs_worry', 'must_go', 'need_rest', 'prefer_other'])
export type Reaction = z.infer<typeof ReactionSchema>

export const OpinionSchema = z
  .object({
    id: z.string(),
    versionId: z.string(),
    stopKey: z.string().nullable(), // null = 일정 전체에 대한 의견
    userId: z.string(),
    userName: z.string(),
    reactions: z.array(ReactionSchema),
    comment: z.string().max(100).optional(),
    appliedInVersionId: z.string().optional(), // 다시 짜기에 반영된 버전
    createdAt: z.string(),
  })
  .refine(o => o.reactions.length > 0 || (o.comment?.trim().length ?? 0) > 0, {
    message: '반응이나 한 줄 의견 중 하나는 있어야 합니다',
  })
export type Opinion = z.infer<typeof OpinionSchema>
