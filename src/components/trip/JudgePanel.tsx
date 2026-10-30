'use client'

// 판정 이유 한 문장 + 배지 + 요약 카드 + 근거. 숫자와 문장은 모두 엔진 결과(JudgeResult)에서 가져온다.
import Link from 'next/link'
import type { JudgeResult, Traveler } from '@/lib/contracts'
import { diffSummary, formatDiffItem, formatRange } from '@/lib/engine'
import { CONDITION_LABEL, CONDITION_SOURCE_TEXT, conditionValueText } from '@/lib/format'
import { Button, Card, Notice, VerdictBadge, cx } from '@/components/ui'

function SummaryCard({ title, value, sub, over }: { title: string; value: string; sub: string; over: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-sm text-muted">{title}</p>
      <p className="my-1 text-lg font-extrabold">
        {value} <span className="text-sm font-semibold text-muted">추정치</span>
      </p>
      <p className={cx('text-sm font-bold', over ? 'text-warn' : 'text-ok')}>
        <span aria-hidden="true">{over ? '! ' : '✓ '}</span>
        {sub}
      </p>
    </div>
  )
}

export function JudgePanel({
  result, prev, travelers, tripId, stopNames, settled, incomplete, onRetry,
}: {
  result: JudgeResult
  prev: JudgeResult | null
  travelers: Traveler[]
  tripId: string
  stopNames: Record<string, string>
  settled: boolean
  incomplete: boolean
  onRetry: () => void
}) {
  const { condition } = result
  const dayOver = result.violations.some(v => v.kind === 'day')
  const longestOver = result.violations.some(v => v.kind === 'continuous')
  const stairsOver = result.violations.filter(v => v.kind === 'stairs').length
  const longestRoute = result.longest.fromStopKey
    ? result.longest.fromStopKey === result.longest.toStopKey
      ? stopNames[result.longest.fromStopKey]
      : `${stopNames[result.longest.fromStopKey] ?? ''} → ${stopNames[result.longest.toStopKey ?? ''] ?? ''}`
    : null
  const speedTraveler = travelers.find(t => t.id === result.speedTravelerId)
  const diff = prev ? diffSummary(prev, result).map(formatDiffItem) : []
  const unknownNames = result.unknownStopKeys.map(key => stopNames[key]).filter(Boolean)

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <VerdictBadge verdict={result.verdict} className="text-base" />
        <p className="min-w-0 flex-1 text-lg font-bold leading-snug">{result.reason}</p>
      </div>
      {!settled && <p role="status" className="text-sm text-muted">다시 계산하는 중이에요…</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        <SummaryCard
          title="하루 총 걷기"
          value={formatRange(result.day)}
          sub={dayOver ? `조건 ${condition.dayMin}분을 넘어요` : `조건 ${condition.dayMin}분 안`}
          over={dayOver}
        />
        <SummaryCard
          title="가장 긴 연속 걷기"
          value={formatRange(result.longest)}
          sub={longestOver ? `조건 ${condition.continuousMin}분을 넘어요` : `조건 ${condition.continuousMin}분 안`}
          over={longestOver}
        />
        <SummaryCard
          title="계단"
          value={stairsOver > 0 ? `${stairsOver}곳` : condition.avoidStairs ? '피하는 중' : '상관없어요'}
          sub={condition.avoidStairs ? (stairsOver > 0 ? '피해야 할 계단 구간이 있어요' : '계단 구간 없음') : '계단은 조건에 넣지 않았어요'}
          over={stairsOver > 0}
        />
      </div>
      {longestRoute && <p className="text-sm text-muted">가장 긴 연속 걷기 구간: {longestRoute}</p>}

      {condition.avoidStairs && result.unrecordedStairs.length > 0 && (
        <Notice tone="info">계단 기록이 없는 구간 {result.unrecordedStairs.length}곳 · 지도 데이터 기준</Notice>
      )}
      {unknownNames.length > 0 && <Notice tone="info">길 정보가 아직 없는 장소: {unknownNames.join(', ')}. 판정은 “정보 부족”으로 나와요.</Notice>}
      {(result.missingLegs.length > 0 || incomplete) && settled && (
        <Notice tone="warn">
          <p>일부 이동 경로를 받지 못했어요. 받은 부분만으로 계산한 결과예요.</p>
          <Button variant="secondary" className="mt-2 min-h-10" onClick={onRetry}>
            다시 받아 보기
          </Button>
        </Notice>
      )}
      {result.pendingConsents.length > 0 && (
        <Notice tone="info">
          <p className="font-bold">부모님 확인이 필요한 조건이 있어요</p>
          <ul className="mt-1 list-disc pl-5">
            {result.pendingConsents.map(consent => {
              const parent = travelers.find(t => t.id === consent.parentTravelerId)
              return (
                <li key={`${consent.field}-${consent.parentTravelerId}`}>
                  {parent?.label ?? '부모님'}: {CONDITION_LABEL[consent.field]} {conditionValueText(consent.field, consent.proposedValue)} {consent.askCreator ? '(여행을 만든 분이 대신 확인해 주세요)' : '(본인이 확인해 주세요)'}
                </li>
              )
            })}
          </ul>
          <Link href={`/trips/${tripId}/travelers`} className="mt-2 inline-block font-bold underline">
            함께 가는 사람·걷기 조건 보기
          </Link>
        </Notice>
      )}

      {diff.length > 0 && (
        <p className="rounded-xl bg-brand-soft px-4 py-3 font-semibold text-brand-strong">
          이전 안과 달라진 점: {diff.join(' · ')}
        </p>
      )}

      <details>
        <summary className="cursor-pointer font-bold text-muted">이 판정에 쓴 조건 보기</summary>
        <ul className="mt-2 space-y-1 text-muted">
          {(['continuousMin', 'dayMin', 'restMin', 'avoidStairs'] as const).map(field => (
            <li key={field}>
              {CONDITION_LABEL[field]}: <strong className="text-ink">{conditionValueText(field, condition[field])}</strong> ({CONDITION_SOURCE_TEXT[result.conditionFrom[field]]})
            </li>
          ))}
          {speedTraveler && <li>걷는 속도는 가장 느린 {speedTraveler.label} 기준이에요 (추정치).</li>}
        </ul>
      </details>
    </Card>
  )
}
