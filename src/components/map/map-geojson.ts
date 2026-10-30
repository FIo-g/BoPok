// 판정 결과(JudgeResult)와 장소·경로 데이터로 지도에 그릴 경로선·핀을 만든다.
// 걷는 시간·계단 수·판정은 엔진 결과를 그대로 쓰고 여기서 다시 계산하지 않는다 (AGENTS.md 6장).
import { along, length as turfLength, lineString } from '@turf/turf'
import type { Feature, LineString } from 'geojson'
import type { Coord, JudgeResult, Leg, PlaceDetail, PlaceNode, Stop, StopResult } from '@/lib/contracts'
import { FEATURE_TOILET } from './map-config'
import type { Bounds, MapPin, RouteCollection, RouteProps, RouteRole, RouteStatus } from './map-types'

// 일정 목록과 지도가 같이 쓰는 항목 id. 장소 안 구간 / 장소 사이 경로 / 장소
export const segmentItemId = (stopKey: string, segmentId: string) => `seg:${stopKey}:${segmentId}`
export const legItemId = (legKey: string) => `leg:${legKey}`
export const stopItemId = (stopKey: string) => `stop:${stopKey}`

export type MapData = {
  stops: Stop[]
  places: Record<string, PlaceDetail>
  legs: Record<string, Leg>
  result: JudgeResult
}

export type RouteOptions = {
  selectedId?: string | null
  // 구간만 보기: 선택한 항목 말고는 흐리게
  dimOthers?: boolean
}

type RouteFeature = Feature<LineString, RouteProps>
type ResolvedOptions = { selectedId: string | null; dimOthers: boolean }

function placeOf(places: Record<string, PlaceDetail>, placeId: string | null | undefined): PlaceDetail | undefined {
  return placeId !== null && placeId !== undefined && Object.hasOwn(places, placeId) ? places[placeId] : undefined
}

// 기록이 없는 구간(계단 unknown)은 정보 부족(회색 점선)으로 본다. 부담 구간은 그대로 warn
function statusOf(stairsStatus: string, status: 'ok' | 'warn'): RouteStatus {
  if (status === 'warn') return 'warn'
  return stairsStatus === 'unknown' ? 'info' : 'ok'
}

function routeFeature(itemId: string, path: Coord[], role: RouteRole, status: RouteStatus, opts: ResolvedOptions): RouteFeature {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: path },
    properties: {
      id: itemId,
      itemId,
      role,
      status,
      selected: itemId === opts.selectedId,
      emphasis: opts.dimOthers && itemId !== opts.selectedId ? 0.3 : 1,
    },
  }
}

function stopSegmentFeatures(stopResult: StopResult, place: PlaceDetail | undefined, opts: ResolvedOptions): RouteFeature[] {
  if (!place) return []
  const byId = new Map(place.segments.map(segment => [segment.id, segment]))
  const features: RouteFeature[] = []
  const seen = new Set<string>()
  for (const r of stopResult.segments) {
    // 주차장·정류장으로 돌아가는 길은 오는 길과 같은 선이라 한 번만 그린다
    if (r.reverse || seen.has(r.segmentId)) continue
    seen.add(r.segmentId)
    const segment = byId.get(r.segmentId)
    if (!segment || segment.path.length < 2) continue
    features.push(
      routeFeature(segmentItemId(stopResult.stopKey, r.segmentId), segment.path, segment.detourOf ? 'detour' : 'main', statusOf(r.stairsStatus, r.status), opts),
    )
  }
  return features
}

// 하루 전체 경로선: 장소 안 구간 + 장소 사이 경로
export function buildRouteGeoJSON(data: MapData, options: RouteOptions = {}): RouteCollection {
  const opts: ResolvedOptions = { selectedId: options.selectedId ?? null, dimOthers: options.dimOthers ?? false }
  const features: RouteFeature[] = []
  for (const stopResult of data.result.stops) {
    const stop = data.stops.find(s => s.key === stopResult.stopKey)
    features.push(...stopSegmentFeatures(stopResult, placeOf(data.places, stop?.placeId), opts))
  }
  for (const legResult of data.result.legs) {
    const leg = data.legs[legResult.legKey]
    if (!leg || leg.path.length < 2) continue
    const walk = legResult.mode === 'walk'
    features.push(
      routeFeature(legItemId(legResult.legKey), leg.path, walk ? 'main' : 'ride', walk ? statusOf(legResult.stairsStatus, legResult.status) : 'ok', opts),
    )
  }
  return { type: 'FeatureCollection', features }
}

function midpoint(path: Coord[]): Coord {
  const line = lineString(path)
  return along(line, turfLength(line) / 2).geometry.coordinates as Coord
}

const accessText = (node: PlaceNode) => (node.kind === 'stop' ? '버스' : 'P')

// 핀: 장소 번호, 첫 장소의 출발 지점(주차장·정류장), 쉼터, 계단 칸 수
export function buildPins(data: MapData): MapPin[] {
  const pins: MapPin[] = []
  const seen = new Set<string>()
  data.stops.forEach((stop, index) => {
    const place = placeOf(data.places, stop.placeId)
    const coord = stop.coord ?? place?.coord
    if (coord) {
      pins.push({ id: `stop-${stop.key}`, kind: 'stop', coord, label: `${index + 1}. ${stop.name}`, text: String(index + 1), itemId: stopItemId(stop.key) })
    }
    if (!place) return
    for (const node of place.nodes) {
      if (seen.has(node.id)) continue
      if ((node.kind === 'parking' || node.kind === 'stop') && index === 0) {
        seen.add(node.id)
        pins.push({ id: node.id, kind: 'start', coord: node.coord, label: `출발: ${node.name}`, text: accessText(node) })
      } else if (node.kind === 'rest') {
        seen.add(node.id)
        pins.push({
          id: node.id,
          kind: 'rest',
          coord: node.coord,
          indoor: node.restType === 'indoor',
          label: node.restType === 'indoor' ? `${node.name} (실내)` : node.name,
        })
      } else if (node.kind === 'toilet' && FEATURE_TOILET) {
        seen.add(node.id)
        pins.push({ id: node.id, kind: 'toilet', coord: node.coord, label: node.name })
      }
    }
  })
  // 계단 표시: 판정에 쓴 구간 가운데에 "! 계단 N칸"
  for (const stopResult of data.result.stops) {
    const stop = data.stops.find(s => s.key === stopResult.stopKey)
    const place = placeOf(data.places, stop?.placeId)
    if (!place) continue
    const done = new Set<string>()
    for (const r of stopResult.segments) {
      if (r.reverse || done.has(r.segmentId) || r.stairsStatus !== 'present' || !r.stairsCount) continue
      done.add(r.segmentId)
      const segment = place.segments.find(s => s.id === r.segmentId)
      if (!segment || segment.path.length < 2) continue
      pins.push({
        id: `stairs-${stopResult.stopKey}-${r.segmentId}`,
        kind: 'stairs',
        coord: midpoint(segment.path),
        label: `! 계단 ${r.stairsCount}칸`,
        itemId: segmentItemId(stopResult.stopKey, r.segmentId),
      })
    }
  }
  for (const legResult of data.result.legs) {
    const leg = data.legs[legResult.legKey]
    if (!leg || legResult.mode !== 'walk' || leg.stairsStatus !== 'present' || !leg.stairsCount || leg.path.length < 2) continue
    pins.push({
      id: `stairs-${legResult.legKey}`,
      kind: 'stairs',
      coord: midpoint(leg.path),
      label: `! 계단 ${leg.stairsCount}칸`,
      itemId: legItemId(legResult.legKey),
    })
  }
  return pins
}

// 경로선 전체를 포함하는 범위. 선이 없으면 핀(장소)으로라도 범위를 만든다
export function routeBounds(fc: RouteCollection, pins: MapPin[] = []): Bounds | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const take = ([x, y]: Coord) => {
    w = Math.min(w, x)
    e = Math.max(e, x)
    s = Math.min(s, y)
    n = Math.max(n, y)
  }
  for (const f of fc.features) for (const c of f.geometry.coordinates) take(c as Coord)
  if (!Number.isFinite(w)) for (const pin of pins) take(pin.coord)
  return Number.isFinite(w) ? [w, s, e, n] : null
}

// 선택한 항목의 경로(구간만 보기·카메라 이동용). 장소를 고르면 그 장소 안 구간 전체, 구간·경로를 고르면 그 하나
export function selectionCoords(fc: RouteCollection, itemId: string | null): Coord[] | null {
  if (!itemId) return null
  const prefix = itemId.startsWith('stop:') ? `seg:${itemId.slice('stop:'.length)}:` : null
  const matched = fc.features.filter(f => (prefix ? f.properties.itemId.startsWith(prefix) : f.properties.itemId === itemId))
  const coords = matched.flatMap(f => f.geometry.coordinates as Coord[])
  return coords.length >= 2 ? coords : null
}

export function coordsBounds(coords: Coord[]): Bounds {
  const xs = coords.map(c => c[0])
  const ys = coords.map(c => c[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
