'use client'

// 일정 화면 오른쪽 지도. 경로선(부담 구간 색), "! 계단 N칸", 쉼터·주차장·정류장 핀, 2D/3D, 구간만 보기.
// 목록에서 구간을 고르면 지도가 그 구간으로 이동하고, 지도에서 누르면 목록이 펼쳐진다(selectedId 를 같이 쓴다).
// 지도를 못 불러와도 목록만으로 모든 정보를 볼 수 있다.
import { useMemo, useState } from 'react'
import {
  LazyMapView, buildPins, buildRouteGeoJSON, coordsBounds, routeBounds, selectionCoords,
  type MapData,
} from '@/components/map'
import { Chip, Notice, cx } from '@/components/ui'

export function TripMap({ data, selectedId, onSelect, className }: { data: MapData | null; selectedId: string | null; onSelect: (id: string | null) => void; className?: string }) {
  const [flat, setFlat] = useState(false)
  const [focusOnly, setFocusOnly] = useState(false)
  const [failed, setFailed] = useState(false)

  const routes = useMemo(() => (data ? buildRouteGeoJSON(data, { selectedId, dimOthers: focusOnly && selectedId !== null }) : null), [data, selectedId, focusOnly])
  const pins = useMemo(() => (data ? buildPins(data) : []), [data])
  const selection = useMemo(() => (routes ? selectionCoords(routes, selectedId) : null), [routes, selectedId])
  const fit = useMemo(() => (selection ? coordsBounds(selection) : routes ? routeBounds(routes, pins) : null), [selection, routes, pins])

  if (failed) {
    return <Notice tone="info" className={className}>지도를 불러오지 못했어요. 왼쪽 목록에서 모든 정보를 볼 수 있어요.</Notice>
  }
  return (
    <div className={cx('relative overflow-hidden rounded-2xl border border-line bg-white', className)}>
      <LazyMapView
        flat={flat}
        routes={routes}
        pins={pins}
        fit={fit}
        focusPath={focusOnly ? selection : null}
        onSelectItem={id => onSelect(id === selectedId ? null : id)}
        onFail={() => setFailed(true)}
      />
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
        <Chip selected={flat} onClick={() => setFlat(v => !v)} className="bg-white/95">
          {flat ? '2D 보는 중' : '3D 보는 중'}<span className="hidden sm:inline"> · 눌러서 바꾸기</span>
        </Chip>
        <Chip
          selected={focusOnly && selection !== null}
          disabled={selection === null}
          onClick={() => setFocusOnly(v => !v)}
          className="bg-white/95 disabled:opacity-60"
          title={selection === null ? '목록이나 지도에서 구간을 먼저 골라 주세요' : undefined}
        >
          구간만 보기
        </Chip>
      </div>
      <ul className="absolute bottom-7 left-3 right-3 z-10 flex flex-row flex-wrap gap-x-3 rounded-xl bg-white/95 px-3 py-1 text-xs font-semibold shadow sm:right-auto sm:flex-col sm:gap-1 sm:py-2 sm:text-sm" aria-label="지도 색 설명">
        <li><span className="mr-2 inline-block h-1.5 w-6 rounded bg-[#1D4ED8] align-middle" />조건 안</li>
        <li><span className="mr-2 inline-block h-1.5 w-6 rounded bg-[#EA580C] align-middle" />부담 구간</li>
        <li><span className="mr-2 inline-block h-0 w-6 border-t-[3px] border-dashed border-[#A8A196] align-middle" />기록 없음</li>
        <li><span className="mr-2 inline-block h-0 w-6 border-t-2 border-dotted border-[#8A847B] align-middle" />차로 이동</li>
      </ul>
    </div>
  )
}
