// 채팅 칸의 판단. 화면 없이 테스트할 수 있게 따로 둔다.
import type { ChatMessage } from '@/lib/contracts'

// 새로 받은 글을 합친다. 서버가 같은 시각의 글을 다시 줄 수 있고(after는 >=),
// 내가 보낸 글이 갱신으로 또 올 수 있어서 id로 거른다. 새 글이 없으면 같은 배열을 돌려줘 다시 그리지 않는다.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const known = new Set(current.map(message => message.id))
  const fresh = incoming.filter(message => !known.has(message.id))
  if (fresh.length === 0) return current
  return [...current, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// 다음에 물을 커서. 가장 늦은 글의 시각이다
export function chatCursor(messages: ChatMessage[]): string | undefined {
  return messages.at(-1)?.createdAt
}

// '2026-11-03T05:07:00.000Z' → 기기 시간대의 '14:07'
export function chatTime(createdAt: string): string {
  const date = new Date(createdAt)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
