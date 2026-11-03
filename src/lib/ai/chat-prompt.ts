// "AI에게 전달하기": 가족 대화를 다시 짜기 프롬프트에 넣는 모양 (설계 2026-11-02 4.5).
// 대화는 여러 사람이 쓴 글이라 의견과 같은 방어를 거친다. 대괄호를 지워 '[부모님]' 표시를 흉내 내지 못하게 한다.
import 'server-only'
import type { ChatMessage } from '@/lib/contracts'
import { hasHealthClaim, sanitizePromptText } from './text-guard'

// 프롬프트가 너무 길면 AI 응답이 느려지고 일정 쪽 내용이 묻힌다. 최근 대화가 지금 바람에 가장 가깝다
export const CHAT_PROMPT_MAX_MESSAGES = 30
export const CHAT_PROMPT_MAX_CHARS = 3000

const CHAT_NAME_MAX = 20

// 대화 글은 다른 사람이 쓴 글이다. 전각·겹낫표 괄호로 '[부모님]' 표시를 흉내 내거나
// 눈에 안 보이는 문자로 길이를 부풀리지 못하게 지운 뒤 공용 정리를 거친다.
function cleanChatText(text: string): string {
  const plain = text
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/[【】〔〕〖〗〘〙〚〛「」『』〈〉《》]/g, '')
  return sanitizePromptText(plain)
}

export function chatPromptLines(messages: ChatMessage[], parentUserIds: ReadonlySet<string>): string[] {
  const lines: string[] = []
  let chars = 0
  // 최근 글부터 담는다. 한 줄이 한도를 넘으면 그 글만 건너뛴다 — 긴 글 하나로 대화 전체가 빠지지 않게
  for (const message of messages.slice(-CHAT_PROMPT_MAX_MESSAGES).reverse()) {
    const text = cleanChatText(message.text)
    if (!text) continue
    // 건강 정보는 AI에 보내지 않는다(설계 4.4). 병·약 이야기가 든 글은 통째로 뺀다 — 낱말만 지우면 남은 말로 짐작이 된다.
    // 화면에는 그대로 보이고, 식단 주의는 '함께 가는 사람'의 건강 정보 칸으로 받는다.
    if (hasHealthClaim(text)) continue
    const marker = parentUserIds.has(message.userId) ? '[부모님] ' : ''
    // 이름도 인용한다. 이름에 적은 글이 대화나 지시처럼 보이지 않게
    const name = JSON.stringify(cleanChatText(message.userName).slice(0, CHAT_NAME_MAX))
    const line = `- ${marker}${name}: ${JSON.stringify(text)}`
    if (chars + line.length > CHAT_PROMPT_MAX_CHARS) continue
    chars += line.length
    lines.unshift(line)
  }
  return lines
}
