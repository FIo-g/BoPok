'use client'

// ③ 그룹 채팅 — 담당 김경선 (설계 2026-11-02 6.2, 6.3). 화면이 보일 때 10초마다 새 글을 받는다.
// 담당은 이 파일만 고친다. 일정 화면(TripScreen)은 고치지 않아도 된다.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card, ErrorNotice, Spinner, TextInput } from '@/components/ui'
import { api } from '@/lib/api-client'
import { CHAT_TEXT_MAX, type ChatMessage } from '@/lib/contracts'
import { errorMessage } from '@/lib/use-async'
import { chatCursor, chatTime, mergeMessages } from './chat-state'
import type { TripSlotProps } from './types'

const CHAT_REFRESH_MS = 10_000

export function ChatSlot({ tripId, userId }: TripSlotProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // 타이머 안에서 최신 글 목록을 보려고 ref에도 둔다
  const messagesRef = useRef<ChatMessage[]>([])
  useEffect(() => {
    messagesRef.current = messages ?? []
  }, [messages])

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const refresh = (after?: string) =>
      api.chat
        .list(tripId, after)
        .then(res => {
          if (!cancelled) setMessages(current => mergeMessages(current ?? [], res.messages))
        })
        .catch((e: unknown) => {
          // 처음 불러오기만 알린다. 주기적 갱신은 다음 차례에 다시 시도하면 된다
          if (!cancelled && after === undefined) setError(errorMessage(e))
        })
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh(chatCursor(messagesRef.current))
    }

    void refresh()
    const timer = setInterval(refreshIfVisible, CHAT_REFRESH_MS)
    // 다른 탭에 있다가 돌아오면 10초를 기다리지 않는다
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [tripId, userId])

  // 새 글이 오면 맨 아래를 보여 준다
  const count = messages?.length ?? 0
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [count])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const saved = await api.chat.post(tripId, body)
      setMessages(current => mergeMessages(current ?? [], [saved]))
      setText('')
    } catch (e) {
      // 쓴 글은 지우지 않는다 — 다시 보낼 수 있게
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-extrabold">가족 대화</h2>
      {messages === null && !error && <Spinner label="대화를 불러오는 중이에요" />}
      {messages?.length === 0 && <p className="text-muted">아직 대화가 없어요. 일정에 대해 먼저 이야기해 보세요.</p>}
      {messages !== null && messages.length > 0 && (
        <ol ref={listRef} role="log" aria-label="가족 대화" className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {messages.map(message => {
            const mine = message.userId === userId
            return (
              <li key={message.id} className={mine ? 'self-end text-right' : 'self-start'}>
                <p className="text-sm text-muted">
                  <span className="font-bold">{mine ? '나' : message.userName}</span> · {chatTime(message.createdAt)}
                </p>
                <p className={`mt-1 inline-block max-w-prose whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-left ${mine ? 'bg-brand-soft' : 'bg-canvas'}`}>{message.text}</p>
              </li>
            )
          })}
        </ol>
      )}
      {error && <ErrorNotice message={error} />}
      <form onSubmit={send} className="flex gap-2">
        <TextInput
          value={text}
          maxLength={CHAT_TEXT_MAX}
          onChange={e => setText(e.target.value)}
          placeholder="가족에게 하고 싶은 말"
          aria-label="가족에게 하고 싶은 말"
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={sending || text.trim() === ''}>보내기</Button>
      </form>
    </Card>
  )
}
