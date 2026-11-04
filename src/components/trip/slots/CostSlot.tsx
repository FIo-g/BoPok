'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlaceCostChoicesResponseSchema, TaxiCostResponseSchema, costPlanContext, legKey, type CostDraft, type SavedCostPlan, type CostItemKind, type LegRequest, type PlaceCostChoices } from '@/lib/contracts'
import { estimateCosts } from '@/lib/engine/cost'
import { api, USE_MOCKS } from '@/lib/api-client'
import { request } from '@/lib/api-client/http'
import { Card, Button } from '@/components/ui'
import type { TripSlotProps } from './types'
import { applyUneditedQuotes, costScope, placeCostKey, taxiCostKey } from './cost-drafts'
import { CostStorage } from './CostStorage'

type Draft = CostDraft
const emptyDraft = (): Draft => ({ amount: '', unit: '', quantity: 1, kind: 'other', option: '' })
const labels: Record<CostItemKind, string> = { admission: '입장료', meal: '식사·카페', lodging: '숙박', taxi: '택시', other: '기타' }
const inputClass = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 py-2 text-base'
const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`
// 출처 링크는 http(s) 주소만 건다 (그 밖의 값은 링크로 만들지 않는다)
const isWebUrl = (value?: string): value is string => !!value && /^https?:\/\//.test(value)

export function CostSlot({ tripId, versionId, day, stops, travelers }: TripSlotProps) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [extras, setExtras] = useState<Record<string, number>>({})
  const touched = useRef(new Set<string>())
  const restore = useCallback((scope: string, plan: SavedCostPlan, force: boolean) => {
    // 첫 조회가 늦게 도착해도 이미 입력 중인 금액을 덮어쓰지 않는다.
    if (!force && touched.current.has(scope)) return
    touched.current.delete(scope)
    setDrafts(previous => {
      const next = { ...previous }
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${scope}:extra-`)) { delete next[key]; continue }
        try { if (JSON.parse(key)[0] === scope) delete next[key] } catch {}
      }
      for (const { key, value } of plan.drafts) next[key] = value
      return next
    })
    setExtras(previous => ({ ...previous, [scope]: plan.extraCount }))
  }, [])
  const [prices, setPrices] = useState<{ scope: string; data: PlaceCostChoices; error: boolean }>({ scope: '', data: [], error: false })
  const [taxiStatus, setTaxiStatus] = useState({ scope: '', busy: false, message: '' })
  const taxiController = useRef<AbortController | null>(null)
  const scope = costScope(tripId, versionId, day)
  const taxiScope = JSON.stringify([scope, travelers.length, stops.map((stop, index) => index > 0
    ? [stop.arriveBy, taxiCostKey(scope, stops[index - 1], stop, travelers.length)] : placeCostKey(scope, stop))])
  const taxiBusy = taxiStatus.scope === taxiScope && taxiStatus.busy
  const taxiMessage = taxiStatus.scope === taxiScope ? taxiStatus.message : ''
  // 범위가 바뀌면 조회를 끊고 '확인 중'도 푼다. 안 풀면 응답 전에 같은 날로 돌아왔을 때 버튼이 잠긴 채 남는다
  useEffect(() => () => {
    taxiController.current?.abort()
    setTaxiStatus(status => status.scope === taxiScope ? { ...status, busy: false } : status)
  }, [taxiScope])
  const idsKey = [...new Set(stops.flatMap(stop => stop.placeId ? [stop.placeId] : []))].join(',')
  // 연습(목업) 모드에는 가격 API가 없고, 장소가 없으면 부를 것도 없다 — 빈 가격표로 본다
  const noPriceCall = USE_MOCKS || !idsKey
  const priceView: typeof prices = noPriceCall ? { scope: idsKey, data: [], error: false } : prices
  useEffect(() => {
    if (noPriceCall) return
    let cancelled = false
    request('/api/places/cost-choices', { method: 'POST', body: { ids: idsKey.split(',') }, schema: PlaceCostChoicesResponseSchema })
      .then(data => { if (!cancelled) setPrices({ scope: idsKey, data, error: false }) })
      .catch(() => { if (!cancelled) setPrices({ scope: idsKey, data: [], error: true }) })
    return () => { cancelled = true }
  }, [idsKey, noPriceCall])
  const rows = useMemo(() => [
    ...stops.flatMap((stop, index) => [
      { id: placeCostKey(scope, stop), stopKey: stop.key, placeId: stop.placeId, label: stop.name, taxi: false },
      ...(index > 0 && stop.arriveBy === 'taxi' ? [{ id: taxiCostKey(scope, stops[index - 1], stop, travelers.length), stopKey: stop.key, placeId: null, label: `${stop.name}까지 택시`, taxi: true }] : []),
    ]),
    ...Array.from({ length: extras[scope] ?? 0 }, (_, index) => ({
      id: `${scope}:extra-${index}`, stopKey: null, placeId: null, label: `기타 비용 ${index + 1}`, taxi: false,
    })),
  ], [scope, stops, extras, travelers.length])
  const calculation = useMemo(() => {
    const charges = rows.flatMap(row => {
      const draft = drafts[row.id]
      if (!draft || draft.amount.trim() === '' || !draft.unit) return []
      const amountKrw = Number(draft.amount)
      if (!Number.isSafeInteger(amountKrw) || amountKrw < 0 || amountKrw > 2000000000 || !Number.isSafeInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 365) return []
      return [{ stopKey: row.stopKey, kind: row.taxi ? 'taxi' as const : draft.kind,
        amountKrw, unit: draft.unit, quantity: draft.quantity }]
    })
    const result = travelers.length > 0 && travelers.length <= 100 ? estimateCosts({ partySize: travelers.length, charges }) : null
    return { result, known: charges.length, missing: rows.length - charges.length }
  }, [rows, drafts, travelers.length])
  function update(id: string, patch: Partial<Draft>) {
    touched.current.add(scope)
    setDrafts(previous => ({ ...previous, [id]: { ...emptyDraft(), ...previous[id], ...patch } }))
  }
  async function loadTaxiPrices() {
    touched.current.add(scope)
    taxiController.current?.abort()
    const controller = new AbortController()
    taxiController.current = controller
    const requestedDrafts = drafts
    const message = (text: string) => {
      if (!controller.signal.aborted) setTaxiStatus({ scope: taxiScope, busy: false, message: text })
    }
    setTaxiStatus({ scope: taxiScope, busy: true, message: '' })
    try {
      const details = idsKey ? await api.places.details(idsKey.split(',')) : []
      if (controller.signal.aborted) return
      const byId = new Map(details.map(place => [place.id, place] as const))
      // 두 끝이 모두 등록된 장소인 택시 구간만 장소 id·좌표로 직접 만든다.
      // requiredLegs는 지점이 없는 장소(가져온 식당·숙박)에 placeId를 붙이지 않아 서버가 묶음 전체를 거절한다.
      const planned = stops.flatMap((stop, index) => {
        const previous = stops[index - 1]
        if (!index || stop.arriveBy !== 'taxi' || !previous.placeId || !stop.placeId) return []
        const from = byId.get(previous.placeId)
        const to = byId.get(stop.placeId)
        if (!from || !to) return []
        const leg: LegRequest = { from: { placeId: from.id, coord: from.coord }, to: { placeId: to.id, coord: to.coord }, mode: 'taxi' }
        return [{ key: taxiCostKey(scope, previous, stop, travelers.length), leg }]
      })
      if (!planned.length) { message('좌표가 있는 택시 구간이 아직 없어요.'); return }
      if (USE_MOCKS) { message('연습 화면에서는 택시 요금을 직접 입력해 주세요.'); return }
      const quotes = await request('/api/places/taxi-costs', { method: 'POST', body: { requests: planned.map(item => item.leg) }, schema: TaxiCostResponseSchema })
      if (controller.signal.aborted) return
      const changes: Record<string, Draft> = {}
      for (const { key, leg } of planned) {
        const quote = quotes.find(quote => quote.key === legKey(leg))
        if (quote) changes[key] = { amount: String(quote.fareKrw), unit: 'shared',
          quantity: Math.max(1, Math.ceil(travelers.length / 4)), kind: 'taxi', option: '', source: quote.source, checkedAt: quote.checkedAt }
      }
      setDrafts(previous => applyUneditedQuotes(previous, requestedDrafts, changes))
      message('거리 기준 추정치예요. 정체·심야·시외 할증·통행료는 포함하지 않았어요.')
    } catch { message('택시 요금을 받지 못했어요. 로그인·장소·경로 정보를 확인하거나 직접 입력해 주세요.') }
  }
  if (!stops.length) return null
  return (
    <Card>
      <h3 className="text-lg font-extrabold">{day}일차 예상 비용 · 한 사람 기준</h3>
      <p className="mt-1 text-sm text-muted">함께 가는 {travelers.length}명 기준 · 여유 20% 포함 · 추정치</p>
      <CostStorage tripId={tripId} versionId={versionId} day={day} scope={scope} context={costPlanContext(stops, travelers.length)}
        drafts={rows.flatMap(row => drafts[row.id] ? [{ key: row.id, value: drafts[row.id] }] : [])}
        extraCount={extras[scope] ?? 0} mock={USE_MOCKS} onRestore={restore} />
      {calculation.result && calculation.known > 0 ? (
        <p className="my-3 text-xl font-extrabold" aria-live="polite">약 {won(calculation.result.perPersonKrw.low)}~{won(calculation.result.perPersonKrw.high)}</p>
      ) : <p className="my-3 font-bold">금액과 계산 단위를 선택하면 합계가 나와요.</p>}
      {calculation.missing > 0 && <p className="mb-3 font-bold text-info">미확인 {calculation.missing}항목은 합계에 포함되지 않았어요.</p>}
      {travelers.length === 0 && <p className="mb-3 text-info">함께 가는 사람을 먼저 넣어 주세요.</p>}
      {priceView.scope === idsKey && priceView.error && <p className="mb-3 text-info">가격표를 불러오지 못했어요. 확인한 금액을 직접 입력할 수 있어요.</p>}
      <details>
        <summary className="min-h-12 cursor-pointer py-3 font-bold">가격 고르기·직접 입력</summary>
        <div className="space-y-4">
          {rows.map(row => {
            const draft = drafts[row.id] ?? emptyDraft()
            const entry = priceView.scope === idsKey ? priceView.data.find(entry => entry.placeId === row.placeId) : undefined
            return <fieldset key={row.id} className="rounded-xl border border-line p-3">
              <legend className="px-1 font-bold">{row.label}</legend>
              {!!entry?.options.length && <label className="mb-2 block text-sm">등록된 가격
                <select aria-label={`${row.label} 등록 가격`} className={inputClass} value={draft.option} onChange={event => {
                  const option = entry.options.find(option => option.id === event.target.value)
                  if (!option) { update(row.id, { option: '' }); return }
                  update(row.id, { option: option.id, amount: String(option.amountKrw), kind: option.kind,
                    unit: option.unit === 'unspecified' ? '' : option.unit, source: option.source, checkedAt: option.checkedAt, confidence: option.confidence })
                }}>
                  <option value="">직접 입력하거나 가격 선택</option>
                  {entry.options.map(option => <option key={option.id} value={option.id}>{option.label} · {won(option.amountKrw)}</option>)}
                </select>
              </label>}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm">금액(원)<input className={inputClass} aria-label={`${row.label} 금액`} type="number" min="0" max="2000000000" step="1" value={draft.amount}
                  placeholder="미확인" onChange={event => update(row.id, { amount: event.target.value, option: '', source: undefined, checkedAt: undefined, confidence: undefined })} /></label>
                <label className="text-sm">계산 단위<select className={inputClass} aria-label={`${row.label} 계산 단위`} value={draft.unit} onChange={event => update(row.id, { unit: event.target.value as Draft['unit'] })}>
                  <option value="">수량 단위를 확인해 주세요</option><option value="per_person">한 사람 금액</option><option value="shared">함께 내는 전체 금액</option>
                </select></label>
                <label className="text-sm">수량(객실·박·차량·횟수)<input className={inputClass} aria-label={`${row.label} 수량`} type="number" min="1" max="365" step="1" value={draft.quantity}
                  onChange={event => update(row.id, { quantity: Number(event.target.value) })} /></label>
                <label className="text-sm">비용 종류<select className={inputClass} aria-label={`${row.label} 비용 종류`} value={row.taxi ? 'taxi' : draft.kind}
                  disabled={row.taxi} onChange={event => update(row.id, { kind: event.target.value as CostItemKind })}>
                  {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select></label>
              </div>
              {entry?.notes.map((note, index) => <p key={`${index}:${note}`} className="mt-2 text-sm text-muted">{note}</p>)}
              {(draft.source || draft.checkedAt) && <p className="mt-2 text-sm text-muted">
                {isWebUrl(draft.source) ? <a href={draft.source} className="underline" target="_blank" rel="noreferrer">가격 출처 확인</a> : '가격 출처'}
                {draft.checkedAt && ` · 확인 ${draft.checkedAt}`}{draft.confidence && ` · 신뢰 ${draft.confidence}`}
              </p>}
            </fieldset>
          })}
          <Button variant="secondary" onClick={() => { touched.current.add(scope); setExtras(previous => ({ ...previous, [scope]: Math.min(20, (previous[scope] ?? 0) + 1) })) }}>기타 비용 더하기</Button>
          {rows.some(row => row.taxi) && <Button variant="secondary" disabled={taxiBusy} onClick={() => void loadTaxiPrices()}>{taxiBusy ? '택시 요금 확인 중…' : 'TMAP 거리로 택시 요금 추정'}</Button>}
          {taxiMessage && <p className="text-sm text-info" role="status">{taxiMessage}</p>}
          <p className="text-sm text-muted">택시는 차량 수(중형 한 대 최대 4명), 숙박은 객실 수×박 수를 수량에 반영해 주세요. 가격 확인일은 API 수집일이며 예약·결제 금액과 다를 수 있어요.</p>
        </div>
      </details>
    </Card>
  )
}
