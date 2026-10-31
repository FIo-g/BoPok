'use client'

// 판정 이유 한 문장 + 배지 + 요약 카드 + 근거. 숫자와 문장은 모두 엔진 결과(JudgeResult)에서 가져온다.
import Link from 'next/link'
import type { JudgeResult, Traveler } from '@/lib/contracts'
import { diffSummary, formatDiffItem } from '@/lib/engine'
import { CONDITION_LABEL, CONDITION_SOURCE_TEXT, conditionValueText, countRideLegsWithoutTime, formatWalk, hasWalkInfoGap, isWalkInfoMissing } from '@/lib/format'
import { Button, Card, Notice, VerdictBadge, cx } from '@/components/ui'

// unknown: 정보가 없어 비교할 수 없음(? 회색, 숫자 없음) / partial: 숫자는 있지만 일부 정보가 빠져 "조건 안"이라고 말할 수 없음(? 회색, 숫자·추정치는 그대로)
// plain: 비교하는 값이 아님(표시 없음). 셋 다 "✓ 조건 안"처럼 보이면 안 된다
function SummaryCard({ title, value, sub, over, unknown = false, partial = false, plain = false, estimate = true }: { title: string; value: string; sub: string; over: boolean; unknown?: boolean; partial?: boolean; plain?: boolean; estimate?: boolean }) {
  const unchecked = unknown || partial
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="text-sm text-muted">{title}</p>
      <p className="my-1 text-lg font-extrabold">
        {value}
        {!unknown && estimate && <span className="ml-1 text-sm font-semibold text-muted">추정치</span>}
      </p>
      <p className={cx('text-sm font-bold', plain ? 'text-muted' : unchecked ? 'text-info' : over ? 'text-warn' : 'text-ok')}>
        <span aria-hidden="true">{plain ? '' : unchecked ? '? ' : over ? '! ' : '✓ '}</span>
        {sub}
      </p>
    </div>
  )
}

// 합계가 일부만 계산됐을 때 카드 아래 글. 색·기호가 아니라 글자로도 "정보 부족"이 읽히게 한다
const PARTIAL_COMPARE_TEXT = '정보 부족: 일부 길 정보가 없어서 조건 안인지 아직 몰라요'

export function JudgePanel({
  result, prev, travelers, tripId, stopNames, settled, incomplete, onRetry, explainText = null, explainFromAi = false,
}: {
  // 바뀐 점 한 줄 (화면에만 보여 주고 저장하지 않는다)
  explainText?: string | null
  explainFromAi?: boolean
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
  // 모든 구간·장소의 계단 기록이 있을 때만 "계단 구간 없음"이라고 말한다 (AGENTS.md 6장)
  const stairsFullyRecorded = result.stops.length > 0 && result.unrecordedStairs.length === 0 && result.unknownStopKeys.length === 0 && result.missingLegs.length === 0
  // 장소 안 길을 아직 조사하지 못해 걷는 시간이 하나도 계산되지 않은 경우: 0분이 아니라 "정보 없음"
  const noWalkInfo = isWalkInfoMissing(result.day, result.verdict)
  // 받지 못한 경로·길 정보 없는 장소가 있으면 합계는 일부만 계산한 값이라 "조건 안"이라고 말하지 않는다 (이미 넘은 카드는 그대로 "넘어요")
  const lacksWalkInfo = hasWalkInfoGap(result)
  const dayPartial = lacksWalkInfo && !noWalkInfo && !dayOver
  const longestPartial = lacksWalkInfo && !noWalkInfo && !longestOver
  // 엔진의 missingLegs 에는 걷는 경로만 들어온다. 차·택시·버스 구간은 이동 시간을 모르는 것(rideMin 이 null)으로 센다
  const missingWalkLegs = result.missingLegs.length
  const rideLegsWithoutTime = countRideLegsWithoutTime(result.legs)
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
          value={formatWalk(result.day, result.verdict)}
          unknown={noWalkInfo}
          partial={dayPartial}
          sub={noWalkInfo ? '길 정보가 없어서 조건과 비교할 수 없어요' : dayOver ? `조건 ${condition.dayMin}분을 넘어요` : dayPartial ? PARTIAL_COMPARE_TEXT : `조건 ${condition.dayMin}분 안`}
          over={dayOver}
        />
        <SummaryCard
          title="가장 긴 연속 걷기"
          value={formatWalk(result.longest, result.verdict)}
          unknown={noWalkInfo}
          partial={longestPartial}
          sub={noWalkInfo ? '길 정보가 없어서 조건과 비교할 수 없어요' : longestOver ? `조건 ${condition.continuousMin}분을 넘어요` : longestPartial ? PARTIAL_COMPARE_TEXT : `조건 ${condition.continuousMin}분 안`}
          over={longestOver}
        />
        <SummaryCard
          title="계단"
          value={stairsOver > 0 ? `${stairsOver}곳` : condition.avoidStairs ? '피하는 중' : '상관없어요'}
          sub={condition.avoidStairs ? (stairsOver > 0 ? '피해야 할 계단 구간이 있어요' : stairsFullyRecorded ? '확인된 모든 구간에 계단 없음' : '계단 기록 없음 (지도 데이터 기준)') : '계단은 조건에 넣지 않았어요'}
          over={stairsOver > 0}
          estimate={false}
          plain={!condition.avoidStairs}
          unknown={condition.avoidStairs && stairsOver === 0 && !stairsFullyRecorded}
        />
      </div>
      {longestRoute && <p className="text-sm text-muted">가장 긴 연속 걷기 구간: {longestRoute}</p>}

      {condition.avoidStairs && result.unrecordedStairs.length > 0 && (
        <Notice tone="info">계단 기록이 없는 구간 {result.unrecordedStairs.length}곳 · 지도 데이터 기준</Notice>
      )}
      {unknownNames.length > 0 && <Notice tone="info">길 정보가 아직 없는 장소: {unknownNames.join(', ')}. 판정은 “정보 부족”으로 나와요.</Notice>}
      {(missingWalkLegs > 0 || incomplete) && settled && (
        <Notice tone="warn">
          <p>일부 이동 경로를 받지 못했어요. 받은 부분만으로 계산한 결과예요.</p>
          <Button variant="secondary" className="mt-2 min-h-10" onClick={onRetry}>
            다시 받아 보기
          </Button>
        </Notice>
      )}
      {rideLegsWithoutTime > 0 && settled && (
        <Notice tone="info">차·택시·버스로 이동하는 구간 {rideLegsWithoutTime}곳은 이동 시간을 아직 계산하지 못해요. 걷는 길만 계산한 결과예요.</Notice>
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

      {(diff.length > 0 || explainText) && (
        <div className="rounded-xl bg-brand-soft px-4 py-3 text-brand-strong">
          {explainText && (
            <p className="text-lg font-extrabold">
              {explainText}
              {explainFromAi && <span className="ml-2 text-sm font-semibold text-muted">AI가 풀어 쓴 한 줄</span>}
            </p>
          )}
          {diff.length > 0 && <p className="font-semibold">이전 안과 달라진 점(추정치): {diff.join(' · ')}</p>}
        </div>
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
