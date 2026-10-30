'use client'

// 버전 선택(번호, 누가/AI가 만들었는지, 확정 표시)과 버전 비교 창
import type { Traveler, VersionSummary } from '@/lib/contracts'
import { diffSummary, formatDiffItem, formatRange } from '@/lib/engine'
import { api } from '@/lib/api-client'
import { madeByText, versionLabel } from '@/lib/format'
import { errorMessage, useAsync } from '@/lib/use-async'
import { useState } from 'react'
import { Badge, Button, Card, Dialog, ErrorNotice, Spinner, VerdictBadge, cx } from '@/components/ui'
import { useJudged } from './useJudged'

export function VersionBar({
  versions, activeId, confirmedId, onSelect, onCompare, disabled,
}: {
  versions: VersionSummary[]
  activeId: string
  confirmedId: string | null
  onSelect: (id: string) => void
  onCompare: () => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">일정 버전</h2>
        {versions.length > 1 && (
          <Button variant="secondary" className="min-h-11" onClick={onCompare}>
            버전 비교
          </Button>
        )}
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="일정 버전">
        {versions.map(version => {
          const active = version.id === activeId
          return (
            <li key={version.id}>
              <button
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onSelect(version.id)}
                className={cx(
                  'min-h-14 rounded-xl border px-4 py-1 text-left disabled:opacity-60',
                  active ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-brand',
                )}
              >
                <span className="flex items-center gap-2 font-extrabold">
                  {versionLabel(version)}
                  {version.id === confirmedId && <Badge tone="ok">✓ 확정</Badge>}
                </span>
                <span className="block text-sm text-muted">{madeByText(version)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CompareColumn({ title, version, judged }: { title: string; version: VersionSummary; judged: ReturnType<typeof useJudged> }) {
  return (
    <Card className="flex-1">
      <p className="text-sm text-muted">{title}</p>
      <h3 className="text-lg font-extrabold">{versionLabel(version)}</h3>
      <p className="mb-2 text-sm text-muted">{madeByText(version)}</p>
      {judged ? (
        <dl className="space-y-1">
          <div><VerdictBadge verdict={judged.result.verdict} /></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">하루 걷기</dt><dd className="font-bold">{formatRange(judged.result.day)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">가장 긴 연속</dt><dd className="font-bold">{formatRange(judged.result.longest)}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">쉬는 시간</dt><dd className="font-bold">{judged.result.restTotalMin}분</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-muted">조건 넘는 곳</dt><dd className="font-bold">{judged.result.violations.length}곳</dd></div>
          <p className="pt-1 text-sm text-muted">{judged.result.reason}</p>
        </dl>
      ) : (
        <Spinner label="계산하는 중" />
      )}
    </Card>
  )
}

export function VersionCompare({ tripId, versions, travelers, initialA, initialB, onClose }: { tripId: string; versions: VersionSummary[]; travelers: Traveler[]; initialA: string; initialB: string; onClose: () => void }) {
  const [aId, setAId] = useState(initialA)
  const [bId, setBId] = useState(initialB)
  const a = useAsync(() => api.trips.getVersion(tripId, aId), `cmp:${tripId}:${aId}`)
  const b = useAsync(() => api.trips.getVersion(tripId, bId), `cmp:${tripId}:${bId}`)
  const ja = useJudged(a.data?.stops, travelers)
  const jb = useJudged(b.data?.stops, travelers)
  const va = versions.find(v => v.id === aId)
  const vb = versions.find(v => v.id === bId)
  const diff = ja && jb ? diffSummary(ja.result, jb.result).map(formatDiffItem) : null
  const select = (value: string, set: (id: string) => void, label: string) => (
    <label className="flex flex-1 items-center gap-2 font-bold">
      {label}
      <select className="min-h-12 flex-1 rounded-xl border border-line bg-white px-3" value={value} onChange={e => set(e.target.value)}>
        {versions.map(v => (
          <option key={v.id} value={v.id}>{versionLabel(v)} · {madeByText(v)}</option>
        ))}
      </select>
    </label>
  )
  return (
    <Dialog title="버전 비교" onClose={onClose}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        {select(aId, setAId, '앞')}
        {select(bId, setBId, '뒤')}
      </div>
      {(a.error || b.error) && <ErrorNotice message={errorMessage(a.error ?? b.error)} />}
      <div className="flex flex-col gap-3 sm:flex-row">
        {va && <CompareColumn title="앞 안" version={va} judged={ja} />}
        {vb && <CompareColumn title="뒤 안" version={vb} judged={jb} />}
      </div>
      {diff && (
        <p className="mt-4 rounded-xl bg-brand-soft px-4 py-3 font-semibold text-brand-strong">
          {diff.length > 0 ? `앞 안에서 뒤 안으로: ${diff.join(' · ')}` : '두 안의 걷기 숫자는 같아요'}
        </p>
      )}
    </Dialog>
  )
}
