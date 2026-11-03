'use client'

// ③ 그룹 채팅과 'AI에게 전달하기' — 담당 김경선 (설계 2026-11-02 6.2, 6.3). 화면이 보일 때 10초마다 새 글을 받는다.
// 담당은 이 파일만 고친다. 일정 화면(TripScreen)은 고치지 않아도 된다.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card, ErrorNotice, Notice, Spinner, TextInput } from '@/components/ui'
import { aiFailure } from '@/lib/ai-fallback'
import { api } from '@/lib/api-client'
import { CHAT_TEXT_MAX, type ChatMessage } from '@/lib/contracts'
import { errorMessage } from '@/lib/use-async'
import { advanceCursor, chatTime, mergeMessages, pollAfter } from './chat-state'
import type { TripSlotProps } from './types'

const CHAT_REFRESH_MS = 10_000

export function ChatSlot({ tripId, userId, versionId }: TripSlotProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [asking, setAsking] = useState(false)
  const [newVersion, setNewVersion] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // 글을 보낸 직후에도 새 글을 받으려고 갱신 함수를 밖에서 부를 수 있게 둔다 (설계 6.3)
  const refreshNow = useRef<() => void>(() => {})
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    let cursor: string | undefined

    const refresh = (after?: string) =>
      api.chat
        .list(tripId, after)
        .then(res => {
          if (cancelled) return
          cursor = advanceCursor(cursor, res.messages)
          setLoadError(null)
          setMessages(current => mergeMessages(current ?? [], res.messages))
        })
        .catch((e: unknown) => {
          // 처음 불러오기만 알린다. 주기적 갱신은 다음 차례에 다시 시도하면 된다
          if (!cancelled && after === undefined) setLoadError(errorMessage(e))
        })
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh(pollAfter(cursor))
    }
    refreshNow.current = () => void refresh(pollAfter(cursor))

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
    const sentText = text
    const body = sentText.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      const saved = await api.chat.post(tripId, body)
      setMessages(current => mergeMessages(current ?? [], [saved]))
      // 보내는 동안 이어 쓴 글은 지우지 않는다
      setText(current => (current === sentText ? '' : current))
      refreshNow.current()
    } catch (e) {
      // 쓴 글은 지우지 않는다 — 다시 보낼 수 있게
      setSendError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  async function sendToAi() {
    if (!versionId) return
    setAsking(true)
    setSendError(null)
    setNewVersion(null)
    try {
      const res = await api.ai.revise({ tripId, versionId, includeChat: true })
      // 바로 새로 열지 않는다. 직접 고치던 일정이 있으면 사라지므로 사람이 눌러서 연다
      setNewVersion(res.version.number)
    } catch (e) {
      const failure = aiFailure(e)
      setSendError(failure.canPick ? 'AI가 지금 일정을 못 짰어요. 잠시 뒤에 다시 시도해 주세요.' : failure.message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-extrabold">가족 대화</h2>
      {messages === null && !loadError && <Spinner label="대화를 불러오는 중이에요" />}
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
      {loadError && <ErrorNotice message={loadError} />}
      {sendError && <ErrorNotice message={sendError} />}
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
      {versionId !== null && count > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button variant="secondary" onClick={sendToAi} disabled={asking}>{asking ? 'AI가 다시 짜는 중…' : 'AI에게 전달하기'}</Button>
          <p className="text-sm text-muted">대화를 읽고 새 안을 만들어요. 지금 일정은 바뀌지 않아요.</p>
        </div>
      )}
      {newVersion !== null && (
        <Notice tone="ok">
          <p className="font-bold">{newVersion}번째 안을 만들었어요.</p>
          <p>저장하지 않고 고치던 일정이 있으면 먼저 저장해 주세요. 확정한 여행은 새로 연 뒤 안 목록에서 {newVersion}번째 안을 골라 주세요.</p>
          <Button variant="secondary" className="mt-2" onClick={() => window.location.reload()}>새 안 보러 가기</Button>
        </Notice>
      )}
    </Card>
  )
}
