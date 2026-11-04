// 둘러보기 이름표 목록을 만든다. 랜드마크 7곳은 먼저 두고, 공유 DB 의 관광지를 뒤에 붙인다.
// 같은 장소가 두 번 보이지 않게 거른다. 화면과 같은 판에서 돌아가는 순수 함수(테스트 가능)
import { placeKindOf, type Coord, type PlaceSummary } from '@/lib/contracts'
import { LANDMARKS, landmarkCenter, type Landmark } from '../map/landmarks'
import { MAP_MAX_BOUNDS } from '../map/map-config'
import type { MapLabel } from '../map/map-types'

// 같은 장소로 볼 거리(m): 이름이 비슷하면 이 안에 있을 때 한 곳으로 친다. 이보다 더 가까우면 이름과 상관없이 같은 곳
const SAME_NAME_M = 150
const SAME_SPOT_M = 30
// 랜드마크와 이름이 '똑같이' 같으면 이 거리 안을 같은 곳으로 본다. 공유 DB 좌표는 랜드마크 모형 중심과 수백 m 어긋나기도 해서 150m 로는 부족하다. 포함 관계로는 넓히지 않는다(한밭수목원 ≠ 한밭수목원 열대식물원)
const SAME_LANDMARK_NAME_M = 1000

type PlaceInput = Pick<PlaceSummary, 'id' | 'name' | 'coord' | 'kind'>

export function isValidCoord(coord: unknown): coord is Coord {
  if (!Array.isArray(coord) || coord.length !== 2) return false
  const [lng, lat] = coord
  if (typeof lng !== 'number' || typeof lat !== 'number') return false
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false
  const [west, south, east, north] = MAP_MAX_BOUNDS
  return lng >= west && lng <= east && lat >= south && lat <= north
}

// 이름 비교용: 띄어쓰기·가운뎃점·괄호 같은 기호를 뺀다
const normName = (name: string) => name.replace(/[\s·.,()\-]/g, '').toLowerCase()

// 두 좌표 사이 거리(m). 대전 정도 범위에서는 평면 근사로 충분하다
export function distanceM(a: Coord, b: Coord): number {
  const midLat = ((a[1] + b[1]) / 2) * Math.PI / 180
  const dx = (a[0] - b[0]) * 111320 * Math.cos(midLat)
  const dy = (a[1] - b[1]) * 110574
  return Math.hypot(dx, dy)
}

export function isSamePlace(a: { name: string; coord: Coord }, b: { name: string; coord: Coord }): boolean {
  const d = distanceM(a.coord, b.coord)
  if (d <= SAME_SPOT_M) return true
  if (d > SAME_NAME_M) return false
  const na = normName(a.name)
  const nb = normName(b.name)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

export function buildTourLabels(places: PlaceInput[], landmarks: Landmark[] = LANDMARKS): MapLabel[] {
  const labels: MapLabel[] = []
  const usedIds = new Set<string>()

  for (const l of landmarks) {
    const coord = landmarkCenter(l)
    if (!isValidCoord(coord) || usedIds.has(l.id)) continue
    labels.push({ id: l.id, name: l.name, coord, emphasis: 'landmark' })
    usedIds.add(l.id)
  }
  // 모형이 대신하는 장소(placeId)는 랜드마크 이름표 하나로 충분하다
  const landmarkPlaceIds = new Set(landmarks.map(l => l.placeId).filter((id): id is string => Boolean(id)))

  for (const p of places) {
    if (placeKindOf(p) !== 'attraction') continue
    const name = p.name.trim()
    if (!name || !isValidCoord(p.coord)) continue
    if (usedIds.has(p.id) || landmarkPlaceIds.has(p.id)) continue
    const candidate = { name, coord: p.coord }
    if (labels.some(label => isSamePlace(label, candidate))) continue
    // 랜드마크 이름과 똑같은 관광지는 랜드마크 이름표 하나로 충분하다(placeId 가 이름이라 위 검사로는 못 거른다)
    const sameAsLandmark = labels.some(label =>
      label.emphasis === 'landmark' &&
      normName(label.name) === normName(name) &&
      distanceM(label.coord, p.coord) <= SAME_LANDMARK_NAME_M)
    if (sameAsLandmark) continue
    labels.push({ id: p.id, name, coord: p.coord, emphasis: 'place' })
    usedIds.add(p.id)
  }
  return labels
}
