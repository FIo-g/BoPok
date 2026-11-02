// 일차별 만족도. 주인: 김경선. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
// 여행이 끝난 뒤 하루씩 "어땠는지"를 남겨, 다음 일정을 짤 때 쓰려는 것이다.
// 묻는 항목은 [2단계] — 지금은 점수 하나와 한 줄(의견과 같은 100자)만 받는다.
import { z } from 'zod'

export const DayFeedbackSchema = z.object({
  tripId: z.string().min(1),
  day: z.number().int().min(1), // 여행 몇째 날 (Stop.day와 같은 기준)
  userId: z.string().min(1),
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(100).optional(), // 의견(OpinionBaseSchema.comment)과 같은 길이
  createdAt: z.string(),
})
export type DayFeedback = z.infer<typeof DayFeedbackSchema>

// 요청 본문: tripId는 주소에서, userId·createdAt은 서버가 정한다
export const DayFeedbackInputSchema = DayFeedbackSchema.pick({ day: true, score: true, comment: true })
export type DayFeedbackInput = z.infer<typeof DayFeedbackInputSchema>
