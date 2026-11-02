// 비용 추정. 주인: 미정 (설계 6장: 2단계에서 정함). 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
// 계산하는 곳(여유 비율을 얼마로 잡을지)과 담당 폴더는 [2단계]. 여기는 주고받는 모양만 정한다.
// 돈은 모두 "원 단위 정수"다 (소수 원이 없고, 합계가 어긋나지 않게 하려는 것이다).
import { z } from 'zod'

export const CostItemKindSchema = z.enum(['admission', 'meal', 'taxi', 'lodging', 'other'])
export type CostItemKind = z.infer<typeof CostItemKindSchema>

export const CostItemSchema = z.object({
  // null = 일정 전체에 드는 비용(예: KTX 왕복표, kind 'other'). 숙박은 그날 마지막 Stop(숙박 장소)의 stopKey에 붙고,
  // 택시는 도착 장소의 stopKey에 붙는다
  stopKey: z.string().nullable(),
  kind: CostItemKindSchema,
  // 한 사람 기준 금액이다. 택시·숙박처럼 함께 내는 돈은 일행 수로 나눈 값을 적는다
  // (합계가 perPersonKrw와 같은 단위여야 하기 때문이다)
  krw: z.number().int().min(0),
})
export type CostItem = z.infer<typeof CostItemSchema>

// 한 사람이 쓰는 돈의 범위. 시간처럼 하나의 값이 아니라 범위로 보여 준다 (서비스 원칙 6장)
// low = 항목 krw의 합계, high = round(low × (1 + bufferRate)). 스키마가 이 계산을 검사하지는 않는다 —
// 계산하는 쪽이 지킬 약속이다 [제안, 2단계에서 확정]
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
