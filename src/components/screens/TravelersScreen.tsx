'use client'

// 함께 가는 사람과 걷기 조건 고치기 (부모님 본인이 직접 입력할 수도 있다). 저장하면 일정 판정이 새 조건으로 다시 계산된다.
import { useState } from 'react'
import Link from 'next/link'
import { useRequireUser } from '@/components/AuthProvider'
import { Badge, Button, Card, Chip, ErrorNotice, Field, Notice, PageShell, PageTitle, Spinner, TextInput } from '@/components/ui'
import { api } from '@/lib/api-client'
import type { Condition, Pace, Sex, Traveler } from '@/lib/contracts'
import { CONDITION_QUESTIONS, UNKNOWN_CHOICE_LABEL } from '@/lib/engine'
import { canClaim, claimTraveler, markSelfFilled, myTraveler, releaseTraveler } from '@/lib/plan/travelers'
import { errorMessage, useAsync } from '@/lib/use-async'

const NUMBER_FIELDS = ['continuousMin', 'dayMin', 'restMin'] as const
type NumberField = (typeof NUMBER_FIELDS)[number]

const question = (id: (typeof CONDITION_QUESTIONS)[number]['id']) => CONDITION_QUESTIONS.find(q => q.id === id)!

function TravelerEditor({ traveler, onChange, onRemove, canRemove, isMe, linkedName, claimable, onClaim, onRelease }: { traveler: Traveler; onChange: (next: Traveler) => void; onRemove: () => void; canRemove: boolean; isMe: boolean; linkedName: string | null; claimable: boolean; onClaim: () => void; onRelease: () => void }) {
  const set = (patch: Partial<Traveler>) => onChange({ ...traveler, ...patch })
  const setCondition = (patch: Partial<Condition>) => set({ condition: { ...traveler.condition, ...patch } })
  const clearCondition = (field: keyof Condition) => {
    const next = { ...traveler.condition }
    delete next[field]
    set({ condition: next })
  }
  const numberOrUndefined = (value: string) => (value === '' ? undefined : Number(value))
  const unknownChip = (selected: boolean, onClick: () => void) => (
    <Chip selected={selected} onClick={onClick}>{UNKNOWN_CHOICE_LABEL}</Chip>
  )

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">
          {traveler.label}
          {isMe && <span className="ml-2 text-muted">(나)</span>}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {traveler.isParent && <Badge tone="brand">부모님</Badge>}
          {traveler.userId && <Badge tone="brand">계정 연결: {isMe ? '나' : (linkedName ?? '가족')}</Badge>}
          {claimable && <Button variant="secondary" className="min-h-10 px-3" onClick={onClaim}>이 사람이 저예요</Button>}
          {isMe && <Button variant="ghost" className="min-h-10 px-3" onClick={onRelease}>연결 풀기</Button>}
          {traveler.filledBySelf ? <Badge tone="ok">✓ 본인이 직접 입력</Badge> : <Badge tone="info">대신 입력 · 본인 확인 전</Badge>}
          {canRemove && <Button variant="danger" className="min-h-10 px-3" onClick={onRemove} aria-label={`${traveler.label} 빼기`}>빼기</Button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="부르는 이름">
          <TextInput value={traveler.label} maxLength={20} onChange={e => set({ label: e.target.value })} />
        </Field>
        <Field label="나이">
          <TextInput type="number" min={0} max={120} value={traveler.age ?? ''} onChange={e => set({ age: numberOrUndefined(e.target.value) })} placeholder="잘 모르면 비워 두세요" />
        </Field>
        <Field label="키 (cm)">
          <TextInput type="number" min={50} max={250} value={traveler.heightCm ?? ''} onChange={e => set({ heightCm: numberOrUndefined(e.target.value) })} placeholder="잘 모르면 비워 두세요" />
        </Field>
        <Field label="성별">
          <select className="min-h-12 w-full rounded-xl border border-line bg-white px-4" value={traveler.sex ?? ''} onChange={e => set({ sex: (e.target.value || undefined) as Sex | undefined })}>
            <option value="">{UNKNOWN_CHOICE_LABEL}</option>
            <option value="female">여성</option>
            <option value="male">남성</option>
          </select>
        </Field>
      </div>
      <label className="flex min-h-12 items-center gap-2 font-semibold">
        <input type="checkbox" className="size-5" checked={traveler.isParent} onChange={e => set({ isParent: e.target.checked })} />
        모시고 가는 부모님이에요 (걷기 조건을 부모님 기준으로 계산해요)
      </label>

      {NUMBER_FIELDS.map(field => {
        const q = question(field)
        const current = traveler.condition[field as NumberField]
        const matched = q.choices.some(c => c.value === current)
        return (
          <fieldset key={field}>
            <legend className="mb-2 font-bold">{q.title}</legend>
            <div className="flex flex-wrap gap-2">
              {q.choices.map(choice => (
                <Chip key={choice.label} selected={current === choice.value} onClick={() => setCondition({ [field]: choice.value as number })}>
                  {choice.label} <span className="text-sm font-normal text-muted">{choice.note}</span>
                </Chip>
              ))}
              {unknownChip(current === undefined, () => clearCondition(field))}
            </div>
            {current !== undefined && !matched && <p className="mt-1 text-sm text-muted">지금 값: {current}분</p>}
            {current === undefined && q.unknownNote && <p className="mt-1 text-sm text-muted">{q.unknownNote}</p>}
          </fieldset>
        )
      })}

      <fieldset>
        <legend className="mb-2 font-bold">{question('avoidStairs').title}</legend>
        <div className="flex flex-wrap gap-2">
          {question('avoidStairs').choices.map(choice => (
            <Chip key={choice.label} selected={traveler.condition.avoidStairs === choice.value} onClick={() => setCondition({ avoidStairs: choice.value as boolean })}>
              {choice.label}
            </Chip>
          ))}
          {unknownChip(traveler.condition.avoidStairs === undefined, () => clearCondition('avoidStairs'))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-bold">{question('pace').title}</legend>
        <div className="flex flex-wrap gap-2">
          {question('pace').choices.map(choice => (
            <Chip key={choice.label} selected={traveler.pace === choice.value} onClick={() => set({ pace: choice.value as Pace })}>
              {choice.label}
            </Chip>
          ))}
          {unknownChip(traveler.pace === 'unknown', () => set({ pace: 'unknown' }))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-bold">{question('mobilityAid').title}</legend>
        <div className="flex flex-wrap gap-2">
          {question('mobilityAid').choices.map(choice => (
            <Chip key={choice.label} selected={traveler.mobilityAid === choice.value} onClick={() => set({ mobilityAid: choice.value as boolean })}>
              {choice.label}
            </Chip>
          ))}
        </div>
      </fieldset>
    </Card>
  )
}

export function TravelersScreen({ tripId }: { tripId: string }) {
  const user = useRequireUser()
  const detail = useAsync(() => api.trips.get(tripId), `travelers:${tripId}:${user?.id}`, user !== null)
  // 고치는 중인 목록. 서버에서 받은 값에서 시작해 저장하기 전까지 화면에만 있다
  const [draft, setDraft] = useState<Traveler[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  // 계정이 연결된 사람의 이름을 보여 주려고 그룹 구성원을 받는다 (연결할 수 있는 계정은 그룹 구성원뿐)
  const groupId = detail.data?.trip.groupId
  const group = useAsync(() => api.groups.get(groupId ?? ''), `travelers-group:${groupId}`, user !== null && groupId !== undefined)

  if (!user || detail.loading) return <Spinner />
  if (detail.error || !detail.data) return <PageShell><ErrorNotice message={errorMessage(detail.error)} onRetry={detail.reload} /></PageShell>

  const travelers = draft ?? detail.data.travelers
  const update = (index: number, next: Traveler) => setDraft(travelers.map((t, i) => (i === index ? next : t)))

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      // 내 계정과 연결된 사람의 걷기 조건을 내가 고쳤을 때만 본인이 직접 입력한 것으로 본다 (설계 7.1.3)
      const toSave = markSelfFilled(detail.data!.travelers, travelers, user!.id)
      const saved = await api.trips.putTravelers(tripId, toSave)
      detail.mutate({ ...detail.data!, travelers: saved })
      setDraft(null)
      setMessage({ tone: 'ok', text: '저장했어요. 일정의 판정이 새 조건으로 다시 계산돼요' })
    } catch (e) {
      setMessage({ tone: 'warn', text: errorMessage(e) })
    }
    setBusy(false)
  }

  function addTraveler() {
    const n = travelers.length + 1
    setDraft([...travelers, { id: `tr-new-${Date.now()}`, label: `일행 ${n}`, pace: 'unknown', mobilityAid: false, isParent: false, condition: {}, filledBySelf: false }])
  }

  return (
    <PageShell className="max-w-3xl">
      <PageTitle
        title="함께 가는 사람"
        sub="걷기 조건은 부모님 말씀이 가장 중요해요. 잘 모르면 “잘 모르겠어요”를 골라도 돼요."
        actions={<Link href={`/trips/${tripId}`} className="inline-flex min-h-12 items-center rounded-xl px-4 font-bold text-muted hover:bg-black/5">← 일정으로</Link>}
      />
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {travelers.length === 0 && <Notice tone="info">아직 함께 가는 사람이 없어요. 아래에서 추가해 주세요.</Notice>}
      {travelers.length > 0 && !myTraveler(travelers, user.id) && (
        <div className="mb-4">
          <Notice tone="info">이 여행에 함께 가신다면, 나에 해당하는 사람에서 “이 사람이 저예요”를 눌러 주세요. 그러면 걷기 조건을 직접 입력할 수 있어요. (계정이 없는 분은 그대로 두세요)</Notice>
        </div>
      )}
      <div className="flex flex-col gap-4">
        {travelers.map((traveler, index) => (
          <TravelerEditor
            key={traveler.id}
            traveler={traveler}
            onChange={next => update(index, next)}
            onRemove={() => setDraft(travelers.filter((_, i) => i !== index))}
            canRemove={travelers.length > 1}
            isMe={traveler.userId === user.id}
            linkedName={group.data?.members.find(m => m.userId === traveler.userId)?.name ?? null}
            claimable={canClaim(travelers, traveler, user.id)}
            onClaim={() => { setDraft(claimTraveler(travelers, traveler.id, user.id)); setMessage({ tone: 'ok', text: `${traveler.label}에 내 계정을 연결했어요. “저장하기”를 누르면 적용돼요` }) }}
            onRelease={() => setDraft(releaseTraveler(travelers, traveler.id, user.id))}
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-5 flex flex-wrap gap-2 border-t border-line bg-canvas/95 py-3">
        <Button variant="secondary" onClick={addTraveler}>+ 사람 더하기</Button>
        <Button onClick={save} disabled={busy || draft === null || travelers.length === 0}>{busy ? '저장하는 중…' : '저장하기'}</Button>
      </div>
    </PageShell>
  )
}
