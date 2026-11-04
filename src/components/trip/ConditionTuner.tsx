'use client'

// 조건 바꿔 보기: 값을 바꾸면 바로 다시 판정하지만 저장되지 않는다 (설계 4.4). 저장은 "함께 가는 사람" 화면에서.
import type { Condition } from '@/lib/contracts'
import { CONDITION_LABEL, TRANSPORT_TEXT } from '@/lib/format'
import { cleanTuned, isTuned, type Tuned } from '@/lib/plan/tuned'
import { Button, Chip } from '@/components/ui'

const STEP = 5
const LIMITS = { continuousMin: [5, 120], dayMin: [15, 480], restMin: [0, 60] } as const

type NumberField = keyof typeof LIMITS

const PACE_CHOICES = [['slow', '천천히'], ['normal', '보통']] as const
const AID_CHOICES = [[true, '써요'], [false, '안 써요']] as const
const TRANSPORT_CHOICES = ['walk', 'car', 'taxi', 'bus'] as const

// 같은 줄에 "기존대로"와 고를 값들을 늘어놓는다. 고른 것을 다시 누르면 기존대로 돌아간다
function ChoiceRow<T extends string | boolean>({ label, value, choices, onPick }: { label: string; value: T | undefined; choices: readonly (readonly [T, string])[]; onPick: (value: T | undefined) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-semibold">{label}</span>
      <span className="flex flex-wrap gap-2" role="group" aria-label={label}>
        <Chip selected={value === undefined} onClick={() => onPick(undefined)}>기존대로</Chip>
        {choices.map(([choice, text]) => (
          <Chip key={String(choice)} selected={value === choice} onClick={() => onPick(value === choice ? undefined : choice)}>{text}</Chip>
        ))}
      </span>
    </div>
  )
}

export function ConditionTuner({
  base, tuned, onChange,
}: {
  // 지금 판정에 쓰고 있는 조건(조건 바꿔 보기가 적용된 값)
  base: Condition
  tuned: Tuned | undefined
  onChange: (tuned: Tuned | undefined) => void
}) {
  const set = (patch: Partial<Condition>) => onChange(cleanTuned({ ...tuned, condition: { ...tuned?.condition, ...patch } }))
  const setOther = (patch: Omit<Tuned, 'condition'>) => onChange(cleanTuned({ ...tuned, ...patch }))
  const bump = (field: NumberField, delta: number) => {
    const [min, max] = LIMITS[field]
    set({ [field]: Math.min(max, Math.max(min, base[field] + delta)) })
  }
  const active = isTuned(tuned)
  return (
    <details className="rounded-2xl border border-line bg-surface p-4" open={active}>
      <summary className="cursor-pointer font-bold">조건 바꿔 보기 (저장되지 않아요)</summary>
      <div className="mt-3 flex flex-col gap-3">
        {(Object.keys(LIMITS) as NumberField[]).map(field => (
          <div key={field} className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{CONDITION_LABEL[field]}</span>
            <span className="flex items-center gap-2">
              <Button variant="secondary" className="min-w-12 px-0" aria-label={`${CONDITION_LABEL[field]} ${STEP}분 줄이기`} onClick={() => bump(field, -STEP)}>
                −
              </Button>
              <strong className="min-w-16 text-center text-lg">{base[field]}분</strong>
              <Button variant="secondary" className="min-w-12 px-0" aria-label={`${CONDITION_LABEL[field]} ${STEP}분 늘리기`} onClick={() => bump(field, STEP)}>
                ＋
              </Button>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{CONDITION_LABEL.avoidStairs}</span>
          <Chip selected={base.avoidStairs} onClick={() => set({ avoidStairs: !base.avoidStairs })}>
            {base.avoidStairs ? '계단을 피해요' : '계단은 괜찮아요'}
          </Chip>
        </div>
        <ChoiceRow label="걷는 속도 (함께 가는 모두)" value={tuned?.pace} choices={PACE_CHOICES} onPick={pace => setOther({ pace })} />
        <ChoiceRow label="지팡이·보행기 (함께 가는 모두)" value={tuned?.mobilityAid} choices={AID_CHOICES} onPick={mobilityAid => setOther({ mobilityAid })} />
        <ChoiceRow label="장소 사이 이동수단" value={tuned?.transport} choices={TRANSPORT_CHOICES.map(t => [t, TRANSPORT_TEXT[t]] as const)} onPick={transport => setOther({ transport })} />
        {active && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-warn">
            <span className="font-bold">지금은 바꿔 본 조건으로 보고 있어요. 저장되지 않아요.</span>
            <Button variant="secondary" className="min-h-10" onClick={() => onChange(undefined)}>
              원래대로
            </Button>
          </div>
        )}
      </div>
    </details>
  )
}
