// 그룹 채팅. 주인: 김경선. 바꾸면 프론트·김태형과 함께 리뷰 (AGENTS.md 3장).
// 가족이 일정 얘기를 나누는 여행별 한 줄 대화방이다. "AI에게 전달하기"로 다시 짜기에 넘길 수 있다
// (ai.ts의 ReviseRequestSchema.includeChat, 설계 4.5).
import { z } from 'zod'

// 한 글의 길이 한도. 의견 한 줄(100자)보다 길게 — 대화는 여러 문장이 되기 쉽다
export const CHAT_TEXT_MAX = 500

export const ChatMessageSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  userId: z.string(),
  userName: z.string(),
  text: z.string().min(1).max(CHAT_TEXT_MAX),
  createdAt: z.string(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

// POST /api/trips/:id/chat 요청 본문. 앞뒤 공백을 자른 뒤 길이를 잰다 (공백뿐인 글 거부)
export const ChatPostRequestSchema = z.object({
  text: z.string().trim().min(1).max(CHAT_TEXT_MAX),
})
export type ChatPostRequest = z.infer<typeof ChatPostRequestSchema>

// GET /api/trips/:id/chat 쿼리. after = 이 시각 이후의 글만 (주기적 갱신용, 주기는 [2단계]).
// 이 시각 이후는 같은 시각을 포함(>=)한다 — 같은 시각에 쓴 글을 놓치지 않으려는 것이고,
// 그래서 이미 받은 글이 한 번 더 올 수 있으니 화면이 id로 중복을 거른다.
// strict: 오타 난 키(aftr)가 조용히 무시되어 전체 목록이 내려가는 일을 막는다.
export const ChatListQuerySchema = z.object({ after: z.iso.datetime().optional() }).strict()
export type ChatListQuery = z.infer<typeof ChatListQuerySchema>

// GET /api/trips/:id/chat 응답. POST는 새로 저장된 글 하나(ChatMessage)를 그대로 돌려준다
export const ChatListResponseSchema = z.object({ messages: z.array(ChatMessageSchema) })
export type ChatListResponse = z.infer<typeof ChatListResponseSchema>
