'use client'

// 일정 목록: 장소마다 시간·머무는 시간·걷는 시간 범위·계단·쉼터·출처, 펼치면 구간별 근거, 장소 사이 이동, 의견.
// 직접 고치기 중이면 순서·빼기·장소 바꾸기·시각·이동수단·꼭 갈 곳 표시를 바로 고칠 수 있다. 숫자는 모두 엔진 결과.
import { useEffect, useRef } from 'react'
import type { JudgeResult, Leg, Opinion, OpinionInput, PlaceDetail, Stop, StopResult, Transport } from '@/lib/contracts'
import { formatRange } from '@/lib/engine'
import { CONFIDENCE_TEXT, TRANSPORT_TEXT, sourceLine, stairsText } from '@/lib/format'
import { legItemId, segmentItemId, stopItemId } from '@/components/map'
import { Badge, Button, cx } from '@/components/ui'
import { OpinionForm, OpinionList } from './OpinionBox'

const TRANSPORTS: Transport[] = ['walk', 'car', 'taxi', 'bus']

export type StopEditing = {
  move: (index: number, delta: -1 | 1) => void
  remove: (key: string) => void
  update: (key: string, patch: Partial<Stop>) => void
  replace: (key: string) => void
}

type Props = {
  stops: Stop[]
  result: JudgeResult
  places: Record<string, PlaceDetail>
  legs: Record<string, Leg>
  selectedId: string | null
  onSelect: (id: string | null) => void
  editing: StopEditing | null
  opinions: Opinion[]
  myUserId: string
  onAddOpinion: (input: OpinionInput) => Promise<void>
  onRemoveOpinion: (id: string) => Promise<void>
}

const StatusBadge = ({ warn, info }: { warn: boolean; info?: boolean }) =>
  warn ? <Badge tone="warn">! 부담</Badge> : info ? <Badge tone="info">? 기록 없음</Badge> : <Badge tone="ok">✓ 조건 안</Badge>

function SegmentRow({ stopKey, r, selectedId, onSelect }: { stopKey: string; r: StopResult['segments'][number]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const id = segmentItemId(stopKey, r.segmentId)
  const selected = selectedId === id
  return (
    <li>
      <button
        type="button"
        id={`item-${id}`}
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : id)}
        className={cx('w-full rounded-xl border px-3 py-2 text-left', selected ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-brand')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold">
            {r.label}
            {r.reverse && <span className="ml-1 font-normal text-muted">(돌아가는 길)</span>}
          </span>
          <StatusBadge warn={r.status === 'warn'} info={r.stairsStatus === 'unknown'} />
        </div>
        <p className="text-muted">
          걷기 {formatRange(r.time)} · 추정치 · {stairsText(r.stairsStatus, r.stairsCount)}
        </p>
        <p className="text-sm text-muted">
          {sourceLine(r.source, r.checkedAt)} · 신뢰 {r.confidence}({CONFIDENCE_TEXT[r.confidence]})
        </p>
      </button>
    </li>
  )
}

function LegRow({ result, leg, selectedId, onSelect, nextStop, editing }: { result: JudgeResult['legs'][number]; leg: Leg | undefined; selectedId: string | null; onSelect: (id: string | null) => void; nextStop: Stop; editing: StopEditing | null }) {
  const id = legItemId(result.legKey)
  const selected = selectedId === id
  const missing = leg === undefined
  return (
    <li className="my-2 flex flex-col gap-2 pl-5 sm:flex-row sm:items-center">
      <button
        type="button"
        id={`item-${id}`}
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : id)}
        className={cx('flex-1 rounded-xl border border-dashed px-3 py-2 text-left', selected ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-brand')}
      >
        <span aria-hidden="true">↓ </span>
        <strong>{TRANSPORT_TEXT[result.mode]}</strong>
        {result.walkTime && <span> 걷기 {formatRange(result.walkTime)} · 추정치</span>}
        {result.rideMin !== null && <span> 약 {Math.round(result.rideMin)}분</span>}
        {leg?.fareKrw !== undefined && <span> · 택시 요금 약 {leg.fareKrw.toLocaleString()}원</span>}
        {result.mode === 'walk' && <span> · {stairsText(result.stairsStatus, leg?.stairsCount)}</span>}
        {result.mode === 'walk' && <span className="ml-2"><StatusBadge warn={result.status === 'warn'} info={result.stairsStatus === 'unknown'} /></span>}
        {missing && <span className="block text-sm text-warn">이 구간의 경로를 아직 받지 못했어요</span>}
        {leg && <span className="block text-sm text-muted">{sourceLine(leg.source, leg.checkedAt)}</span>}
      </button>
      {editing && (
        <label className="flex items-center gap-2 font-semibold">
          이동 방법
          <select
            className="min-h-12 rounded-xl border border-line bg-white px-3"
            value={nextStop.arriveBy}
            onChange={e => editing.update(nextStop.key, { arriveBy: e.target.value as Transport })}
          >
            {TRANSPORTS.map(mode => (
              <option key={mode} value={mode}>
                {TRANSPORT_TEXT[mode]}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  )
}

export function StopList(props: Props) {
  const { stops, result, places, legs, selectedId, onSelect, editing, opinions, myUserId, onAddOpinion, onRemoveOpinion } = props
  const listRef = useRef<HTMLOListElement>(null)

  // 지도에서 고른 항목이 목록 안 보이는 곳이면 그 항목으로 스크롤한다
  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[id="item-${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  return (
    <ol ref={listRef} className="flex flex-col">
      {stops.map((stop, index) => {
        const stopResult = result.stops.find(s => s.stopKey === stop.key)
        const place = stop.placeId ? places[stop.placeId] : undefined
        const itemId = stopItemId(stop.key)
        const segSelected = selectedId?.startsWith(`seg:${stop.key}:`) ?? false
        const open = selectedId === itemId || segSelected
        const legAfter = result.legs.find(l => l.fromStopKey === stop.key)
        const nextStop = stops[index + 1]
        const stopOpinions = opinions.filter(o => o.stopKey === stop.key)
        const restNames = (stop.restNodeIds.length > 0 ? stop.restNodeIds : [])
          .map(id => place?.nodes.find(n => n.id === id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n))
        const restOptions = place?.nodes.filter(n => n.kind === 'rest') ?? []
        const hasStairs = stopResult?.segments.some(s => !s.reverse && s.stairsStatus === 'present')
        return (
          <li key={stop.key}>
            <article
              id={`item-${itemId}`}
              className={cx('rounded-2xl border bg-surface p-4', selectedId === itemId ? 'border-brand ring-2 ring-brand/30' : 'border-line')}
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-9 flex-none place-items-center rounded-full bg-brand text-lg font-extrabold text-white" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xl font-extrabold leading-tight">
                    <span className="sr-only">{index + 1}번째 장소: </span>
                    {stop.name}
                    {stop.mustVisit && <Badge tone="brand" className="ml-2 align-middle">♥ 꼭 갈 곳</Badge>}
                    {stop.reservedAt && <Badge tone="info" className="ml-2 align-middle">예약 {stop.reservedAt}</Badge>}
                  </h3>
                  <p className="text-muted">
                    {stop.startTime ?? '시간 미정'}
                    {stop.visitMin !== undefined && ` · 약 ${stop.visitMin}분 머물러요`}
                    {place?.indoor && ' · 실내'}
                    {!editing && index === 0 && ` · ${TRANSPORT_TEXT[stop.arriveBy]}로 출발`}
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onSelect(selectedId === itemId ? null : itemId)}
                  className="min-h-11 rounded-lg px-3 font-bold text-brand-strong underline"
                >
                  {open ? '접기' : '구간별 근거'}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {stopResult?.known ? (
                  <>
                    <Badge tone="neutral">걷기 {formatRange(stopResult.walk)} · 추정치</Badge>
                    <Badge tone={hasStairs ? 'warn' : stopResult.segments.some(s => s.stairsStatus === 'unknown') ? 'info' : 'ok'}>
                      {hasStairs ? '! 계단 있음' : stopResult.segments.some(s => s.stairsStatus === 'unknown') ? '? 계단 기록 없음' : '✓ 계단 없음'}
                    </Badge>
                  </>
                ) : (
                  <Badge tone="info">? 길 정보 없음</Badge>
                )}
                {restNames.map(node => (
                  <Badge key={node.id} tone="brand">
                    ☕ {node.name}에서 쉬기{node.restType === 'indoor' ? ' (실내)' : node.restType === 'outdoor' ? ' (야외)' : ''}
                  </Badge>
                ))}
                {restNames.length === 0 && restOptions.length > 0 && (
                  <span className="text-sm text-muted">
                    쉼터 {restOptions.map(n => `${n.name}${n.restType === 'indoor' ? '(실내)' : n.restType === 'outdoor' ? '(야외)' : ''}`).join(', ')}
                  </span>
                )}
              </div>
              {place && (
                <p className="mt-1 text-sm text-muted">
                  {sourceLine(place.source, place.checkedAt)} · 신뢰 {place.confidence}({CONFIDENCE_TEXT[place.confidence]})
                </p>
              )}

              {open && stopResult && stopResult.segments.length > 0 && (
                <ul className="mt-3 space-y-2" aria-label={`${stop.name} 구간별 근거`}>
                  {stopResult.segments.map((r, i) => (
                    <SegmentRow key={`${r.segmentId}-${r.reverse}-${i}`} stopKey={stop.key} r={r} selectedId={selectedId} onSelect={onSelect} />
                  ))}
                </ul>
              )}

              {editing && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Button variant="secondary" className="min-h-11 px-3" disabled={index === 0} onClick={() => editing.move(index, -1)} aria-label={`${stop.name} 위로`}>
                    ▲ 위로
                  </Button>
                  <Button variant="secondary" className="min-h-11 px-3" disabled={index === stops.length - 1} onClick={() => editing.move(index, 1)} aria-label={`${stop.name} 아래로`}>
                    ▼ 아래로
                  </Button>
                  <Button variant="secondary" className="min-h-11 px-3" onClick={() => editing.replace(stop.key)}>
                    장소 바꾸기
                  </Button>
                  <Button variant="danger" className="min-h-11 px-3" onClick={() => editing.remove(stop.key)} aria-label={`${stop.name} 빼기`}>
                    빼기
                  </Button>
                  <label className="flex items-center gap-2 font-semibold">
                    시작 시각
                    <input
                      type="time"
                      className="min-h-12 rounded-xl border border-line bg-white px-3"
                      value={stop.startTime ?? ''}
                      onChange={e => editing.update(stop.key, { startTime: e.target.value || undefined })}
                    />
                  </label>
                  <label className="flex items-center gap-2 font-semibold">
                    머무는 시간(분)
                    <input
                      type="number"
                      min={0}
                      step={5}
                      className="min-h-12 w-24 rounded-xl border border-line bg-white px-3"
                      value={stop.visitMin ?? ''}
                      onChange={e => editing.update(stop.key, { visitMin: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                  {index === 0 && (
                    <label className="flex items-center gap-2 font-semibold">
                      출발 방법
                      <select className="min-h-12 rounded-xl border border-line bg-white px-3" value={stop.arriveBy} onChange={e => editing.update(stop.key, { arriveBy: e.target.value as Transport })}>
                        {TRANSPORTS.map(mode => (
                          <option key={mode} value={mode}>
                            {TRANSPORT_TEXT[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex min-h-12 items-center gap-2 font-semibold">
                    <input type="checkbox" className="size-5" checked={stop.mustVisit} onChange={e => editing.update(stop.key, { mustVisit: e.target.checked })} />
                    꼭 갈 곳
                  </label>
                  <label className="flex items-center gap-2 font-semibold">
                    예약 시각
                    <input
                      type="time"
                      className="min-h-12 rounded-xl border border-line bg-white px-3"
                      value={stop.reservedAt ?? ''}
                      onChange={e => editing.update(stop.key, { reservedAt: e.target.value || undefined })}
                    />
                  </label>
                </div>
              )}

              <OpinionList opinions={stopOpinions} myUserId={myUserId} onRemove={onRemoveOpinion} />
              <OpinionForm stopKey={stop.key} onSubmit={onAddOpinion} label={`${stop.name}에 대한 의견 남기기`} />
            </article>
            {legAfter && nextStop && (
              <ol>
                <LegRow result={legAfter} leg={legs[legAfter.legKey]} selectedId={selectedId} onSelect={onSelect} nextStop={nextStop} editing={editing} />
              </ol>
            )}
            {!legAfter && nextStop && editing && (
              <div className="my-2 pl-5 text-muted">
                이 장소와 다음 장소 사이 이동 정보를 계산할 수 없어요 (좌표가 없어요)
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
