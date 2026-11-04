'use client'

// 여행자 카드 맨 아래의 건강 정보 편집기 (선택 입력). 병·약 "종류"만 받고, 보이는 범위와 동의를 함께 받는다 (설계 4.4).
// 받은 목록은 서버가 이미 보는 사람에 맞춰 거른 것이다 — 화면은 받은 것만 쓴다.
// 건강 값은 민감정보라서 화면 코드에서 console.* 로 찍지 않고, 에러 문구에도 값을 넣지 않는다.
import { useState } from 'react'
import { Badge, Button, Chip, Notice } from '@/components/ui'
import { api } from '@/lib/api-client'
import {
  HEALTH_CONDITION_LABEL,
  HealthConditionSchema,
  HealthVisibilitySchema,
  MEDICATION_CLASS_LABEL,
  MedicationClassSchema,
  type HealthVisibility,
  type Traveler,
  type TravelerHealth,
} from '@/lib/contracts'
import { canSubmitHealth, healthEditMode, healthFormInput, initialHealthForm, toggleIn } from '@/lib/plan/health-form'
import { errorMessage } from '@/lib/use-async'

const VISIBILITY_LABEL: Record<HealthVisibility, string> = {
  group: '가족 모두에게 보여요',
  self: '본인에게만 보여요',
}

const listText = (labels: string[]) => (labels.length > 0 ? labels.join(', ') : '고른 것 없음')

type HealthEditorProps = {
  tripId: string
  travelerId: string
  // 서버에 저장된 여행자. 고칠 권한은 화면 초안(draft)이 아니라 이것으로 가른다 (healthEditMode)
  savedTraveler: Pick<Traveler, 'userId'> | undefined
  viewerUserId: string
  // 서버가 이 사람에게 보여 준 기록. 못 보는 기록은 목록에 아예 없다
  existing: TravelerHealth | undefined
  onSaved: (saved: TravelerHealth) => void
  onRemoved: (travelerId: string) => void
}

export function HealthEditor({ tripId, travelerId, savedTraveler, viewerUserId, existing, onSaved, onRemoved }: HealthEditorProps) {
  const [form, setForm] = useState(() => initialHealthForm(existing))
  // 서버가 준 기록이 바뀌면(다른 화면에서 저장, 계정 연결 뒤 새로 보이게 됨 등) 폼을 그 기록으로 다시 채운다.
  // 그대로 두면 "저장됨"인데 칩이 비어 있고, 그 상태로 저장하면 기록을 빈 값으로 덮어쓴다.
  const [seededFrom, setSeededFrom] = useState(existing?.consentAt)
  if (existing?.consentAt !== seededFrom) {
    setSeededFrom(existing?.consentAt)
    setForm(initialHealthForm(existing))
  }
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  const mode = healthEditMode({ existing, savedTraveler, viewerUserId })
  // 못 보는 기록은 목록에 없어서 "없음"이라고 말하면 거짓일 수 있다. 읽기만 하는 사람에게는 있을 때만 배지를 보인다
  const badge = existing ? <Badge tone="ok"><span aria-hidden="true">✓</span> 저장됨</Badge> : mode === 'edit' || mode === 'unsaved' ? <Badge tone="neutral">없음</Badge> : null

  // 저장 중 flag 는 finally 에서 끈다: React <Activity> 가 화면 상태를 남기므로 실패해도 꺼져야 다음에 다시 누를 수 있다
  async function save() {
    const input = healthFormInput(form)
    if (input === null) return
    setBusy('save')
    setNotice(null)
    try {
      const saved = await api.health.put(tripId, travelerId, input)
      onSaved(saved)
      // 고칠 때마다 동의를 다시 받는다
      setForm(initialHealthForm(saved))
      setNotice({ tone: 'ok', text: '저장했어요' })
    } catch (e) {
      setNotice({ tone: 'warn', text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  // 지우기 = 동의 철회. 되돌릴 수 없지만 확인 창 없이 바로 지운다 (버튼 문구가 결과를 말한다)
  async function remove() {
    setBusy('remove')
    setNotice(null)
    try {
      await api.health.remove(tripId, travelerId)
      onRemoved(travelerId)
      setForm(initialHealthForm(undefined))
      setNotice({ tone: 'ok', text: '지웠어요. 이 여행의 식단 주의에서도 빠져요' })
    } catch (e) {
      setNotice({ tone: 'warn', text: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <details className="rounded-xl border border-line bg-white p-4">
      {/* summary에 flex를 주면 펼침 삼각형이 사라진다 — 펼칠 수 있다는 표시가 보이게 안쪽 span에 준다 */}
      <summary className="min-h-12 cursor-pointer font-bold">
        <span className="inline-flex flex-wrap items-center gap-2 align-middle">
          <span className="text-lg">건강 정보 (선택)</span>
          {badge}
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-4">
        <p className="font-semibold">의학적 조언이 아니에요. 의사·약사와 상의해 주세요</p>

        {mode === 'unsaved' && <Notice tone="info">먼저 아래 ‘저장하기’를 눌러 이 분을 저장한 뒤 입력할 수 있어요</Notice>}

        {(mode === 'readonly_linked' || mode === 'readonly_entered') && (
          <>
            <Notice tone="info">{mode === 'readonly_linked' ? '이 분이 직접 입력해요' : '처음 입력한 가족만 고칠 수 있어요'}</Notice>
            {existing && (
              <dl className="grid gap-1">
                <div><dt className="inline font-bold">병: </dt><dd className="inline">{listText(existing.conditions.map(c => HEALTH_CONDITION_LABEL[c]))}</dd></div>
                <div><dt className="inline font-bold">약 종류: </dt><dd className="inline">{listText(existing.medicationClasses.map(m => MEDICATION_CLASS_LABEL[m]))}</dd></div>
                <div><dt className="inline font-bold">보이는 범위: </dt><dd className="inline">{VISIBILITY_LABEL[existing.visibility]}</dd></div>
              </dl>
            )}
          </>
        )}

        {mode === 'edit' && (
          <>
            <fieldset>
              <legend className="mb-2 font-bold">해당하는 병이 있으면 골라 주세요 (여러 개 가능)</legend>
              <div className="flex flex-wrap gap-2">
                {HealthConditionSchema.options.map(value => (
                  <Chip key={value} selected={form.conditions.includes(value)} onClick={() => setForm(prev => ({ ...prev, conditions: toggleIn(prev.conditions, value, HealthConditionSchema.options) }))}>
                    {HEALTH_CONDITION_LABEL[value]}
                  </Chip>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 font-bold">드시는 약의 종류 (여러 개 가능)</legend>
              <div className="flex flex-wrap gap-2">
                {MedicationClassSchema.options.map(value => (
                  <Chip key={value} selected={form.medicationClasses.includes(value)} onClick={() => setForm(prev => ({ ...prev, medicationClasses: toggleIn(prev.medicationClasses, value, MedicationClassSchema.options) }))}>
                    {MEDICATION_CLASS_LABEL[value]}
                  </Chip>
                ))}
              </div>
              <p className="mt-1 text-sm text-muted">약 이름이 아니라 종류만 받아요. 해당하는 것이 없으면 고르지 않아도 돼요</p>
            </fieldset>

            <fieldset>
              <legend className="mb-2 font-bold">누구에게 보일까요?</legend>
              <div className="flex flex-wrap gap-2">
                {HealthVisibilitySchema.options.map(value => (
                  <Chip key={value} selected={form.visibility === value} onClick={() => setForm(prev => ({ ...prev, visibility: value }))}>
                    {VISIBILITY_LABEL[value]}
                  </Chip>
                ))}
              </div>
              <p className="mt-1 text-sm text-muted">
                본인에게만 보이게 하면 다른 가족 화면에는 건강 정보도, 식단 주의도 나오지 않아요. 일정의 식당 고르기에는 누구 때문인지 밝히지 않고 반영돼요
                {savedTraveler?.userId === undefined && ' (계정이 없는 분은 처음 입력한 사람이 본인 대신 봐요)'}
              </p>
            </fieldset>

            <label className="flex min-h-12 items-start gap-2 font-semibold">
              <input type="checkbox" className="mt-1 size-5 shrink-0" checked={form.consent} onChange={e => setForm(prev => ({ ...prev, consent: e.target.checked }))} />
              병·약 정보는 민감한 정보예요. 이 여행의 식단 주의를 보여 주고, AI가 식당을 고를 때 ‘피할 음식’(예: 짠 음식)만 알려 주는 데 써요. 병·약 이름과 누구인지는 AI에 보내지 않아요. 계정 연결이 바뀌면 지워져요
            </label>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={!canSubmitHealth(form, busy !== null)}>
                {busy === 'save' ? '저장하는 중…' : '건강 정보 저장'}
              </Button>
              {existing && (
                <Button variant="danger" onClick={remove} disabled={busy !== null}>
                  {busy === 'remove' ? '지우는 중…' : '지우기(동의 철회)'}
                </Button>
              )}
            </div>
          </>
        )}

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>
    </details>
  )
}
