'use client'

// 장소(또는 일정 전체)에 붙는 반응 버튼과 한 줄 의견. 가족 누구나 남기고, 누가 남겼는지 이름과 함께 보여 준다 (설계 5장).
import { useState } from 'react'
import type { Opinion, OpinionInput, Reaction } from '@/lib/contracts'
import { REACTION_MARK, REACTION_TEXT } from '@/lib/format'
import { Badge, Button, Chip, ErrorNotice, TextInput } from '@/components/ui'
import { errorMessage } from '@/lib/use-async'

const REACTIONS = Object.keys(REACTION_TEXT) as Reaction[]
const COMMENT_MAX = 100

export function OpinionList({ opinions, myUserId, onRemove }: { opinions: Opinion[]; myUserId: string; onRemove: (id: string) => Promise<void> }) {
  if (opinions.length === 0) return null
  return (
    <ul className="mt-3 space-y-2">
      {opinions.map(opinion => (
        <li key={opinion.id} className="rounded-xl bg-canvas px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{opinion.userName}</strong>
            {opinion.reactions.map(reaction => (
              <Badge key={reaction} tone="brand">
                <span aria-hidden="true">{REACTION_MARK[reaction]}</span>
                {REACTION_TEXT[reaction]}
              </Badge>
            ))}
            {opinion.appliedInVersionId && <Badge tone="ok">✓ 반영됨</Badge>}
            {opinion.userId === myUserId && (
              <button type="button" className="ml-auto min-h-10 px-2 text-sm font-bold text-muted underline" onClick={() => onRemove(opinion.id)}>
                내 의견 지우기
              </button>
            )}
          </div>
          {opinion.comment && <p className="mt-1">{opinion.comment}</p>}
        </li>
      ))}
    </ul>
  )
}

export function OpinionForm({ stopKey, onSubmit, label }: { stopKey: string | null; onSubmit: (input: OpinionInput) => Promise<void>; label: string }) {
  const [open, setOpen] = useState(false)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const empty = reactions.length === 0 && comment.trim() === ''

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ stopKey, reactions, comment: comment.trim() || null })
      setReactions([])
      setComment('')
      setOpen(false)
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <Button variant="secondary" className="mt-3 min-h-11" onClick={() => setOpen(true)}>
        {label}
      </Button>
    )
  }
  return (
    <div className="mt-3 rounded-xl border border-line bg-white p-3">
      <p className="mb-2 font-bold">어떠세요? 여러 개 골라도 돼요</p>
      <div className="flex flex-wrap gap-2">
        {REACTIONS.map(reaction => (
          <Chip
            key={reaction}
            selected={reactions.includes(reaction)}
            onClick={() => setReactions(current => (current.includes(reaction) ? current.filter(r => r !== reaction) : [...current, reaction]))}
          >
            <span aria-hidden="true">{REACTION_MARK[reaction]}</span> {REACTION_TEXT[reaction]}
          </Chip>
        ))}
      </div>
      <div className="mt-3">
        <TextInput
          value={comment}
          maxLength={COMMENT_MAX}
          onChange={e => setComment(e.target.value)}
          placeholder="한 줄 의견 (선택, 100자까지)"
          aria-label="한 줄 의견"
        />
        <p className="mt-1 text-right text-sm text-muted">{comment.length}/{COMMENT_MAX}</p>
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="mt-2 flex gap-2">
        <Button onClick={submit} disabled={busy || empty}>
          남기기
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          취소
        </Button>
      </div>
    </div>
  )
}
