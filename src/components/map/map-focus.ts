import { bbox, bearing, booleanIntersects, buffer, lineString, point } from '@turf/turf'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { Coord } from '@/lib/contracts'

export const FOCUS_BUFFER_M = 60

export type FocusZone = {
  polygon: Feature<Polygon>
  // [서, 남, 동, 북]
  bounds: [number, number, number, number]
}

// 선택한 구간 경로 주변 범위(기본 60m)
export function focusZone(path: Coord[], meters = FOCUS_BUFFER_M): FocusZone | null {
  if (path.length < 2) return null
  const polygon = buffer(lineString(path), meters, { units: 'meters' }) as Feature<Polygon> | undefined
  if (!polygon) return null
  const [w, s, e, n] = bbox(polygon)
  return { polygon, bounds: [w, s, e, n] }
}

// 범위와 겹치는 건물 fid 목록. 상자(bbox)로 먼저 거르고 겹치는 것만 정밀 계산한다
// 건물 목록은 지도 타일에서 읽은 것(querySourceFeatures)이라 타일 경계에서 같은 건물이 여러 조각으로 올 수 있다 → fid 로 한 번만 센다
export function nearBuildingIds(buildings: { features: Feature[] } | FeatureCollection, zone: FocusZone): number[] {
  const [zw, zs, ze, zn] = zone.bounds
  const ids = new Set<number>()
  for (const f of buildings.features) {
    const fid = f.properties?.fid
    if (typeof fid !== 'number') continue
    const [w, s, e, n] = bbox(f)
    if (e < zw || w > ze || n < zs || s > zn) continue
    if (booleanIntersects(f, zone.polygon)) ids.add(fid)
  }
  return [...ids].sort((a, b) => a - b)
}

// 범위 모양만 뚫린 덮개 폴리곤. outer = [서, 남, 동, 북]
export function veilPolygon(outer: [number, number, number, number], zone: FocusZone): Feature<Polygon> {
  const [w, s, e, n] = outer
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]], zone.polygon.geometry.coordinates[0]] },
  }
}

// 구간 시작→끝 길이 화면을 왼쪽에서 오른쪽으로 가로지르게 하는 카메라 방향(bearing).
// 카메라가 바라보는 방향의 오른쪽이 구간 진행 방향이 되도록 90도 돌린다.
export function crossingBearing(path: Coord[]): number {
  if (path.length < 2) return 0
  const b = bearing(point(path[0]), point(path[path.length - 1]))
  return ((b - 90 + 540) % 360) - 180
}
