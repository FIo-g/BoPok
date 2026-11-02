// "AI에게 전달하기": 가족 대화를 다시 짜기 프롬프트에 넣는 모양 (설계 2026-11-02 4.5).
// 대화는 여러 사람이 쓴 글이라 의견과 같은 방어를 거친다. 대괄호를 지워 '[부모님]' 표시를 흉내 내지 못하게 한다.
import type { ChatMessage } from '@/lib/contracts'
import { sanitizePromptText } from './text-guard'

// 프롬프트가 너무 길면 AI 응답이 느려지고 일정 쪽 내용이 묻힌다. 최근 대화가 지금 바람에 가장 가깝다
export const CHAT_PROMPT_MAX_MESSAGES = 30
export const CHAT_PROMPT_MAX_CHARS = 3000

export function chatPromptLines(messages: ChatMessage[], parentUserIds: ReadonlySet<string>): string[] {
  const lines: string[] = []
  let chars = 0
  // 최근 글부터 담고, 한도를 넘으면 더 오래된 글은 넣지 않는다
  for (const message of messages.slice(-CHAT_PROMPT_MAX_MESSAGES).reverse()) {
    const marker = parentUserIds.has(message.userId) ? '[부모님] ' : ''
    const line = `- ${marker}${sanitizePromptText(message.userName)}: ${JSON.stringify(sanitizePromptText(message.text))}`
    if (chars + line.length > CHAT_PROMPT_MAX_CHARS) break
    chars += line.length
    lines.unshift(line)
  }
  return lines
}
