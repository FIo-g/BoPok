'use client'

import { useState } from 'react'
import { api, USE_MOCKS } from '@/lib/api-client'
import { PlaceRecommendationResponseSchema, type PlaceKind, type PlaceSummary, type PlaceRecommendationResponse } from '@/lib/contracts'
import { useAsync, errorMessage } from '@/lib/use-async'
import { Button, ErrorNotice, Spinner, TextInput } from '@/components/ui'

type Props = { kind: PlaceKind; usedIds: string[]; onPick: (place: PlaceSummary) => void; busy?: boolean }
const selectClass = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 py-2'

export function ServicePlacePicker({ kind, usedIds, onPick, busy }: Props) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const ids = JSON.stringify([...new Set(usedIds)].slice(-100))
  const anchors = useAsync(() => api.places.details(JSON.parse(ids)), `service-anchors:${ids}`)
  const from = anchors.data?.find(place => place.id === fromId)
  const to = anchors.data?.find(place => place.id === toId)
  const request = { kind, query, near: from?.coord, route: from && to && from.id !== to.id ? [from.coord, to.coord] : undefined, limit: 20 }
  const key = JSON.stringify(request)
  const result = useAsync<PlaceRecommendationResponse>(async () => {
    if (USE_MOCKS) return { catalogReady: true, method: 'keyword', distanceBasis: 'straight_line', routeCheckRequired: true,
      items: (await api.places.list({ kind, q: query, limit: 20 })).map(place => ({ place, menus: [] })) }
    const response = await fetch('/api/places/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key })
    if (!response.ok) throw new Error(response.status === 401 ? '로그인 후 추천을 볼 수 있어요.' : '추천 후보를 불러오지 못했어요.')
    return PlaceRecommendationResponseSchema.parse(await response.json())
  }, `service-recommendations:${key}`)
  return <div>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setQuery(text.trim()); if (query === text.trim()) result.reload() }}>
      <TextInput className="min-w-0 flex-1" value={text} maxLength={100} onChange={event => setText(event.target.value)} placeholder="메뉴·장소·원하는 분위기로 찾기" aria-label="음식·숙박 검색어" />
      <Button className="shrink-0 whitespace-nowrap" type="submit">찾기</Button>
    </form>
    {!!anchors.data?.length && <div className="my-3 grid gap-2 sm:grid-cols-2">
      <label>가까운 곳을 찾을 기준<select className={selectClass} value={fromId} onChange={event => setFromId(event.target.value)}>
        <option value="">기준 장소 선택</option>
        {anchors.data.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
      </select></label>
      <label>다음 방문지(선택)<select className={selectClass} value={toId} onChange={event => setToId(event.target.value)} disabled={!from || !anchors.data?.some(place => place.id !== from.id)}>
        <option value="">두 장소 사이 동선도 고려</option>
        {anchors.data.filter(place => place.id !== fromId).map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
      </select></label>
    </div>}
    <p className="my-3 text-sm text-muted">{result.data?.method === 'vector' ? '의미가 가까운 순으로 검색했어요.' : '이름·메뉴·설명에서 찾은 결과예요.'} 거리와 동선은 직선 기준이며 실제 이동 경로는 장소를 넣은 뒤 확인해 주세요.</p>
    {USE_MOCKS && <p className="my-2 text-sm text-info">연습용 장소 목록이에요. 실제 수집 자료는 실제 API 모드에서 볼 수 있어요.</p>}
    {result.error && <ErrorNotice message={errorMessage(result.error)} onRetry={result.reload} />}
    {result.loading ? <Spinner /> : result.data?.catalogReady === false
      ? <p className="py-4 text-info">추천 자료를 등록하고 있어요. 현재 관광지 목록은 위 관광지 버튼에서 볼 수 있어요.</p>
      : result.data?.items.length ? <ul className="space-y-3">{result.data.items.map(item => <li key={item.place.id} className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-bold">{item.place.name}</p>
          <Button disabled={busy} onClick={() => onPick(item.place)}>{usedIds.includes(item.place.id) ? '또 넣기' : '넣기'}</Button>
        </div>
        <p className="text-muted">{item.place.address ?? item.place.category}</p>
        {item.distanceM !== undefined && <p>기준 장소에서 직선 약 {(item.distanceM / 1000).toFixed(1)}km</p>}
        {item.straightLineDetourM !== undefined && <p>두 장소 사이 추가 직선거리 약 {(item.straightLineDetourM / 1000).toFixed(1)}km</p>}
        {!!item.menus.length && <p className="mt-2">{item.menus.map(menu => `${menu.name}${menu.priceKrw === undefined ? ' (가격 미확인)' : ` ${menu.priceKrw.toLocaleString('ko-KR')}원`}`).join(' · ')}</p>}
        {!!item.menus.length && <p className="text-sm text-muted">메뉴 수량 단위와 음식 주의 태그는 별도 확인이 필요해요.</p>}
        <p className="mt-2 text-sm text-muted">API 자료 확인 {item.place.checkedAt} · 신뢰 {item.place.confidence} · 계단 기록은 상세에서 확인해 주세요.</p>
        {item.place.source && <a className="text-sm text-brand-strong underline" href={item.place.source} target="_blank" rel="noreferrer">자료 출처</a>}
      </li>)}</ul> : !result.error && <p className="py-6 text-center text-muted">조건에 맞는 자료가 없어요. 검색어나 기준 장소를 바꿔 보세요.</p>}
  </div>
}
