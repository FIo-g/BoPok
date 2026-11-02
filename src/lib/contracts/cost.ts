// 비용 추정. 주인: 미정 (설계 6장: 2단계에서 정함). 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
// 계산하는 곳(여유 비율을 얼마로 잡을지)과 담당 폴더는 [2단계]. 여기는 주고받는 모양만 정한다.
// 돈은 모두 "원 단위 정수"다 (소수 원이 없고, 합계가 어긋나지 않게 하려는 것이다).
import { z } from 'zod'

export const CostItemKindSchema = z.enum(['admission', 'meal', 'taxi', 'lodging', 'other'])
export type CostItemKind = z.infer<typeof CostItemKindSchema>

export const CostItemSchema = z.object({
  stopKey: z.string().nullable(), // null = 일정 전체 비용(숙박 등). 택시는 도착 장소의 stopKey
  kind: CostItemKindSchema,
  krw: z.number().int().min(0),
})
export type CostItem = z.infer<typeof CostItemSchema>

// 한 사람이 쓰는 돈의 범위. 시간처럼 하나의 값이 아니라 범위로 보여 준다 (서비스 원칙 6장)
export const CostEstimateSchema = z
  .object({
    perPersonKrw: z.object({
      low: z.number().int().min(0),
      high: z.number().int().min(0),
    }),
    items: z.array(CostItemSchema),
    bufferRate: z.number().min(0).max(1), // 여유 비율 (예: 0.2 = 20%)
  })
  .refine((e) => e.perPersonKrw.low <= e.perPersonKrw.high, {
    message: '낮은 값이 높은 값보다 클 수 없어요',
    path: ['perPersonKrw'],
  })
export type CostEstimate = z.infer<typeof CostEstimateSchema>
