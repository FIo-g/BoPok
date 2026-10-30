'use client'

// 새 여행: A 붙여넣기 / B 처음부터 → (A) 일정 정리 확인 → AI 인터뷰 대화 → 일정 만들기 → 일정 화면 (설계 4.2, 6.3)
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireUser } from '@/components/AuthProvider'
import { PlacePicker } from '@/components/trip/PlacePicker'
import { Badge, Button, Card, Chip, ErrorNotice, Field, Notice, PageShell, PageTitle, Spinner, TextArea, TextInput, cx } from '@/components/ui'
import { api, isApiError } from '@/lib/api-client'
import type { InterviewResponse, PlaceSummary, Stop, StartMode } from '@/lib/contracts'
import { stopFromPlace } from '@/lib/plan/stop-edit'
import { STYLE_OPTIONS } from '@/lib/trip-options'
import { errorMessage } from '@/lib/use-async'

type Step =
  | { name: 'start' }
  | { name: 'paste'; tripId: string }
  | { name: 'review'; tripId: string; stops: Stop[]; unmatched: string[] }
  | { name: 'interview'; tripId: string }
  | { name: 'making'; tripId: string }

type Message = { role: 'assistant' | 'user'; text: string }

function StartStep({ groupId, onCreated }: { groupId: string; onCreated: (tripId: string, mode: StartMode) => void }) {
  const [mode, setMode] = useState<StartMode>('scratch')
  const [title, setTitle] = useState('부모님과 대전 하루 여행')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const trip = await api.trips.create({ groupId, title, mode })
      onCreated(trip.id, mode)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const option = (value: StartMode, title: string, body: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={cx('rounded-2xl border p-4 text-left', mode === value ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-brand')}
    >
      <span className="block text-lg font-extrabold">{mode === value && '✓ '}{title}</span>
      <span className="text-muted">{body}</span>
    </button>
  )
  return (
    <form onSubmit={create} className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {option('paste', 'A. 짜 둔 일정이 있어요', '메모나 메신저에 적어 둔 일정을 붙여 넣으면 장소별로 정리해 드려요.')}
        {option('scratch', 'B. 처음부터 짜 주세요', '스타일과 예산을 고르면 부모님 걸음에 맞는 일정을 만들어 드려요.')}
      </div>
      <Field label="여행 이름">
        <TextInput value={title} onChange={e => setTitle(e.target.value)} required maxLength={60} />
      </Field>
      {error && <ErrorNotice message={error} />}
      <Button type="submit" disabled={busy || title.trim() === ''}>
        {busy ? '만드는 중…' : '다음'}
      </Button>
    </form>
  )
}

function PasteStep({ tripId, onParsed }: { tripId: string; onParsed: (stops: Stop[], unmatched: string[]) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState(false)

  async function parse() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.ai.parseSchedule({ tripId, text })
      onParsed(res.stops, res.unmatched)
    } catch (e) {
      // AI 가 안 되면 장소를 직접 고르게 한다 (설계 6.4)
      setError(isApiError(e) && e.fallback ? '일정을 정리하지 못했어요. 아래 “장소 직접 고르기”로 이어갈 수 있어요.' : errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="짜 둔 일정을 붙여 넣어 주세요" hint="시간과 장소가 줄마다 있으면 더 잘 정리돼요. 예) 10:00 한밭수목원">
        <TextArea rows={8} value={text} onChange={e => setText(e.target.value)} maxLength={5000} placeholder={'10:00 한밭수목원\n12:00 점심\n14:00 국립중앙과학관'} />
      </Field>
      {error && <ErrorNotice message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={parse} disabled={busy || text.trim() === ''}>
          {busy ? '정리하는 중…' : '장소별로 정리하기'}
        </Button>
        <Button variant="secondary" onClick={() => setPick(true)} disabled={busy}>
          장소 직접 고르기
        </Button>
      </div>
      {pick && (
        <PlacePicker
          title="일정에 넣을 장소 고르기"
          usedIds={[]}
          onClose={() => setPick(false)}
          onPick={(place: PlaceSummary) => {
            setPick(false)
            onParsed([stopFromPlace(place, [])], [])
          }}
        />
      )}
    </div>
  )
}

function ReviewStep({ tripId, stops, unmatched, onNext }: { tripId: string; stops: Stop[]; unmatched: string[]; onNext: () => void }) {
  const [list, setList] = useState(stops)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.trips.saveVersion(tripId, { parentId: null, stops: list, madeBy: 'user', note: '붙여넣은 일정' })
      onNext()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold">이렇게 정리했어요</h2>
      {list.length === 0 ? (
        <Notice tone="warn">장소를 찾지 못했어요. 이전 화면으로 돌아가 장소를 직접 골라 주세요.</Notice>
      ) : (
        <ol className="space-y-2">
          {list.map((stop, i) => (
            <li key={stop.key} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white p-3">
              <span><strong>{i + 1}. {stop.name}</strong> <span className="text-muted">{stop.startTime ?? '시간 미정'}</span></span>
              <Button variant="danger" className="min-h-10 px-3" onClick={() => setList(list.filter(s => s.key !== stop.key))} aria-label={`${stop.name} 빼기`}>빼기</Button>
            </li>
          ))}
        </ol>
      )}
      {unmatched.length > 0 && (
        <Notice tone="info">
          우리 장소 목록에 없는 곳: {unmatched.join(', ')}. 일정에는 넣었지만 길 정보가 없어서 걷는 시간은 계산하지 않고 판정이 “정보 부족”으로 나와요. 필요 없으면 위에서 “빼기”를 눌러 주세요.
        </Notice>
      )}
      {error && <ErrorNotice message={error} />}
      <Button onClick={save} disabled={busy || list.length === 0}>
        {busy ? '저장하는 중…' : '이 일정으로 계속하기'}
      </Button>
    </div>
  )
}

function InterviewStep({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState<InterviewResponse | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [customStyle, setCustomStyle] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  // 첫 질문 받기 (개발 서버에서 효과가 두 번 돌아도 한 번만 부른다)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api.ai
      .interview({ tripId })
      .then(res => {
        setQuestion(res)
        setMessages([{ role: 'assistant', text: res.text }])
        setBusy(false)
      })
      .catch(e => {
        setError(errorMessage(e))
        setBusy(false)
      })
  }, [tripId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [messages, question])

  async function answer(input: { choiceIndex?: number; text?: string }, shown: string) {
    if (!question) return
    setBusy(true)
    setError(null)
    setMessages(m => [...m, { role: 'user', text: shown }])
    try {
      // questionId 를 같이 보내면 같은 답이 두 번 가도 칸을 건너뛰지 않는다
      const res = await api.ai.interview({ tripId, questionId: question.questionId, answer: input })
      setQuestion(res)
      setText('')
      setStyles([])
      setCustomStyle('')
      setMessages(m => [...m, { role: 'assistant', text: res.text }])
      if (res.done) {
        // 서버 인터뷰는 여행자만 저장한다. 여행 칸은 화면이 PATCH로 저장 (docs/roles/frontend.md)
        const { date, transport, styles: filledStyles, budget } = res.filled
        const patch = {
          ...(date ? { date } : {}),
          ...(transport ? { transport } : {}),
          ...(filledStyles.length ? { styles: filledStyles } : {}),
          ...(budget ? { budget } : {}),
        }
        if (Object.keys(patch).length > 0) await api.trips.update(tripId, patch).catch(() => undefined)
        onDone()
      }
    } catch (e) {
      setError(isApiError(e) && e.fallback ? 'AI가 답을 이해하지 못했어요. 아래 버튼에서 골라 주세요.' : errorMessage(e))
    }
    setBusy(false)
  }

  const isStyles = question?.slot === 'styles'
  const choices = question?.choices ?? []
  // 스타일은 여러 개를 골라 쉼표로 이어 보낸다. 마지막 칩은 "기타(직접 입력)"
  const otherIndex = isStyles ? choices.findIndex(c => c.startsWith('기타')) : -1
  const styleChips = isStyles ? (choices.length > 0 && otherIndex >= 0 ? choices.filter((_, i) => i !== otherIndex) : [...STYLE_OPTIONS]) : []

  function submitStyles() {
    const picked = [...styles, ...(customStyle.trim() ? [customStyle.trim()] : [])]
    if (picked.length > 0) void answer({ text: picked.join(',') }, picked.join(', '))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={cx('max-w-[85%] rounded-2xl px-4 py-3', m.role === 'assistant' ? 'self-start bg-white border border-line' : 'self-end bg-brand text-white')}>
            {m.role === 'assistant' && <span className="mb-1 block text-sm font-bold text-muted">보폭 도우미</span>}
            {m.text}
          </div>
        ))}
        {busy && <p role="status" className="self-start text-muted">생각하는 중이에요…</p>}
        <div ref={endRef} />
      </div>
      {error && <ErrorNotice message={error} />}

      {question && !question.done && !busy && (
        <Card className="flex flex-col gap-3">
          {isStyles ? (
            <>
              <div className="flex flex-wrap gap-2">
                {styleChips.map(style => (
                  <Chip key={style} selected={styles.includes(style)} onClick={() => setStyles(cur => (cur.includes(style) ? cur.filter(s => s !== style) : [...cur, style]))}>
                    {style}
                  </Chip>
                ))}
              </div>
              <TextInput value={customStyle} onChange={e => setCustomStyle(e.target.value)} maxLength={30} placeholder="기타: 직접 입력 (선택)" aria-label="기타 스타일 직접 입력" />
              <Button onClick={submitStyles} disabled={styles.length === 0 && customStyle.trim() === ''}>선택 완료</Button>
            </>
          ) : (
            <>
              {choices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {choices.map((choice, index) => (
                    <Chip key={choice} onClick={() => answer({ choiceIndex: index }, choice)}>{choice}</Chip>
                  ))}
                </div>
              )}
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault()
                  if (text.trim()) void answer({ text: text.trim() }, text.trim())
                }}
              >
                <TextInput value={text} onChange={e => setText(e.target.value)} maxLength={500} placeholder="직접 입력해도 돼요 (선택)" aria-label="직접 입력" />
                <Button type="submit" disabled={text.trim() === ''}>보내기</Button>
              </form>
            </>
          )}
        </Card>
      )}
    </div>
  )
}

function MakingStep({ tripId }: { tripId: string }) {
  const router = useRouter()
  const [error, setError] = useState<{ message: string; fallback: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pick, setPick] = useState(false)
  const ran = useRef(-1)

  useEffect(() => {
    if (ran.current === attempt) return
    ran.current = attempt
    // A(붙여넣기)도 저장된 일정을 AI 가 다듬는다 (설계 6.4). 처음부터(B)와 같은 경로
    api.ai
      .generate({ tripId })
      .then(() => router.replace(`/trips/${tripId}`))
      .catch(e => setError({ message: errorMessage(e), fallback: isApiError(e) && Boolean(e.fallback) }))
  }, [attempt, tripId, router])

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNotice message={`일정을 짜지 못했어요. ${error.message}`} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { setError(null); setAttempt(a => a + 1) }}>다시 시도</Button>
          <Button variant="secondary" onClick={() => setPick(true)}>장소를 직접 고르기</Button>
        </div>
        {pick && (
          <PlacePicker
            title="일정에 넣을 장소 고르기"
            usedIds={[]}
            onClose={() => setPick(false)}
            onPick={async place => {
              setPick(false)
              try {
                await api.trips.saveVersion(tripId, { parentId: null, stops: [stopFromPlace(place, [])], madeBy: 'user', note: '직접 고른 일정' })
                router.replace(`/trips/${tripId}`)
              } catch (e) {
                setError({ message: errorMessage(e), fallback: true })
              }
            }}
          />
        )}
      </div>
    )
  }
  return <Spinner label="부모님 걸음에 맞춰 일정을 짜고 있어요. 잠시만요" />
}

export function NewTripScreen() {
  const user = useRequireUser()
  const groupId = useSearchParams().get('group')
  const [step, setStep] = useState<Step>({ name: 'start' })
  const [mode, setMode] = useState<StartMode>('scratch')

  if (!user) return <Spinner label="확인하고 있어요" />
  if (!groupId) return <PageShell className="max-w-2xl"><Notice tone="warn">어느 그룹의 여행인지 알 수 없어요. “내 그룹”에서 그룹을 고른 뒤 “새 여행 만들기”를 눌러 주세요.</Notice></PageShell>

  const stepTitle = { start: '새 여행 만들기', paste: '일정 붙여 넣기', review: '정리한 일정 확인', interview: '몇 가지만 여쭤볼게요', making: '일정 만드는 중' }[step.name]
  return (
    <PageShell className="max-w-2xl">
      <PageTitle title={stepTitle} sub={step.name === 'start' ? '부모님과 함께하는 대전 하루 여행을 같이 짜 봐요.' : undefined} actions={step.name !== 'start' && <Badge tone="brand">{mode === 'paste' ? 'A. 붙여넣기' : 'B. 처음부터'}</Badge>} />
      {step.name === 'start' && (
        <StartStep groupId={groupId} onCreated={(tripId, m) => { setMode(m); setStep(m === 'paste' ? { name: 'paste', tripId } : { name: 'interview', tripId }) }} />
      )}
      {step.name === 'paste' && <PasteStep tripId={step.tripId} onParsed={(stops, unmatched) => setStep({ name: 'review', tripId: step.tripId, stops, unmatched })} />}
      {step.name === 'review' && <ReviewStep tripId={step.tripId} stops={step.stops} unmatched={step.unmatched} onNext={() => setStep({ name: 'interview', tripId: step.tripId })} />}
      {step.name === 'interview' && <InterviewStep tripId={step.tripId} onDone={() => setStep({ name: 'making', tripId: step.tripId })} />}
      {step.name === 'making' && <MakingStep tripId={step.tripId} />}
    </PageShell>
  )
}
