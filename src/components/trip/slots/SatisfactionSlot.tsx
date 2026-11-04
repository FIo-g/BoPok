'use client'

// ① 일차별 만족도: 그날이 오면 '오늘 어떠셨어요?' — 담당 김경선 (설계 2026-11-02 6.2).
// 담당은 이 파일만 고친다. 일정 화면(TripScreen)은 고치지 않아도 된다.
import { useState } from 'react'
import { Button, Card, Chip, ErrorNotice, Notice, TextInput } from '@/components/ui'
import { api } from '@/lib/api-client'
import type { DayFeedbackItem } from '@/lib/contracts'
import { errorMessage, useAsync } from '@/lib/use-async'
import { dayHasArrived, feedbackQuestion, localToday, matchesSaved, savedFeedbackKey } from './satisfaction-state'
import type { TripSlotProps } from './types'

const COMMENT_MAX = 100

// 숫자만 보이면 어느 쪽이 좋은 건지 모르므로 글자를 함께 쓴다 (AGENTS 6장)
const SCORES = [
  { score: 1, text: '많이 힘들었어요' },
  { score: 2, text: '조금 힘들었어요' },
  { score: 3, text: '보통이에요' },
  { score: 4, text: '좋았어요' },
  { score: 5, text: '아주 좋았어요' },
] as const

const scoreText = (score: number) => SCORES.find(one => one.score === score)?.text ?? `${score}점`

function FeedbackForm({ tripId, day, mine, onSaved }: { tripId: string; day: number; mine?: DayFeedbackItem; onSaved: (saved: DayFeedbackItem) => void }) {
  const [score, setScore] = useState<number | null>(mine?.score ?? null)
  const [comment, setComment] = useState(mine?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 저장된 값이 다른 곳에서 바뀌면 입력을 그 값으로 맞춘다. 일정 화면과 확정 화면은 숨겨진 채 상태가 남아서,
  // 맞추지 않으면 옛 점수가 보이고 '고치기'를 누를 때 새 값을 덮어쓴다
  const savedKey = savedFeedbackKey(mine)
  const [seenKey, setSeenKey] = useState(savedKey)
  if (savedKey !== seenKey) {
    setSeenKey(savedKey)
    // 방금 여기서 저장한 값이면 입력이 같으므로 '남겼어요'를 그대로 둔다
    if (!matchesSaved(mine, score, comment)) {
      setScore(mine?.score ?? null)
      setComment(mine?.comment ?? '')
      setSaved(false)
      setError(null)
    }
  }

  async function save() {
    if (score === null) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const text = comment.trim()
      const item = await api.feedback.save(tripId, { day, score, ...(text ? { comment: text } : {}) })
      setSaved(true)
      onSaved(item)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="만족도">
        {SCORES.map(one => (
          <Chip
            key={one.score}
            selected={score === one.score}
            disabled={busy} // 저장 응답을 기다리는 동안 고친 값이 응답으로 되돌아가지 않게 막는다
            onClick={() => {
              setScore(one.score)
              setSaved(false)
            }}
          >
            {one.score}점 · {one.text}
          </Chip>
        ))}
      </div>
      <div>
        <TextInput value={comment} maxLength={COMMENT_MAX} disabled={busy} onChange={e => {
            setComment(e.target.value)
            setSaved(false)
          }} placeholder="한 줄 남기기 (선택, 100자까지)" aria-label="한 줄 남기기" />
        <p className="mt-1 text-right text-sm text-muted">{comment.length}/{COMMENT_MAX}</p>
      </div>
      {error && <ErrorNotice message={error} />}
      {saved && <Notice tone="ok">남겼어요. 고마워요</Notice>}
      <div>
        <Button onClick={save} disabled={busy || score === null}>{mine ? '고치기' : '남기기'}</Button>
      </div>
    </>
  )
}

export function SatisfactionSlot({ tripId, day, userId }: TripSlotProps) {
  const feedback = useAsync(() => api.feedback.list(tripId), `feedback:${tripId}:${userId}`, userId !== '')
  const today = localToday()
  const data = feedback.data

  // 이 칸은 없어도 일정을 보는 데 지장이 없어서, 못 불러오면 조용히 숨긴다
  if (!data || !dayHasArrived(data.tripDate, day, today)) return null

  // 다시 받지 않고 저장 응답을 바로 반영한다 — 저장 직후 날을 바꿔 돌아와도 옛 값이 채워지지 않게
  const applySaved = (saved: DayFeedbackItem) => {
    const others = data.feedback.filter(item => !(item.day === saved.day && item.userId === saved.userId))
    feedback.mutate({ ...data, feedback: [...others, saved] })
  }

  const ofDay = data.feedback.filter(item => item.day === day)
  const mine = ofDay.find(item => item.userId === userId)
  const others = ofDay.filter(item => item.userId !== userId)

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-extrabold">{feedbackQuestion(data.tripDate, day, today)}</h2>
      {/* 날을 바꾸면 입력을 그날 값으로 다시 채운다. 저장 뒤에는 '남겼어요'가 남도록 날만 key로 쓴다 */}
      <FeedbackForm key={day} tripId={tripId} day={day} mine={mine} onSaved={applySaved} />
      {others.length > 0 && (
        <ul className="space-y-2 border-t border-line pt-3">
          {others.map(item => (
            <li key={item.userId}>
              <span className="font-bold">{item.userName}</span> · {item.score}점 {scoreText(item.score)}
              {item.comment && <p className="text-muted">{item.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
