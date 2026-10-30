// AI가 고른 자리(초안) → 일정의 Stop[]. 장소 상세와 좌표를 아는 만큼만 채운다.
// 이동수단은 여기서 정하지만 걷는 시간·거리는 엔진 밖에서 만들지 않는다 (설계 7.3.1).
import 'server-only'
import type { Coord, PlaceSummary, Stop, Transport } from '@/lib/contracts'

export type DraftStop = {
  placeId: string | null
  name: string
  startTime?: string
  visitMin?: number
  seated?: boolean
  mustVisit?: boolean
  reservedAt?: string
  coord?: Coord
}

// 직선거리. 대중교통일 때 700 m 이하면 걸어갈 수 있는 거리로 본다 (설계 7.3.1).
const WALKABLE_TRANSIT_M = 700
const EARTH_RADIUS_M = 6371000

function distanceM(a: Coord, b: Coord): number {
  const rad = Math.PI / 180
  const latA = a[1] * rad
  const latB = b[1] * rad
  const dLat = latB - latA
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function arriveByFor(
  transport: 'car' | 'transit' | 'taxi',
  prev: Coord | undefined,
  next: Coord | undefined,
): Transport {
  if (transport === 'car') return 'car'
  if (transport === 'taxi') return 'taxi'
  // 좌표를 모르면 걷는 시간을 지어내지 않도록 버스로 둔다.
  if (prev === undefined || next === undefined) return 'bus'
  return distanceM(prev, next) <= WALKABLE_TRANSIT_M ? 'walk' : 'bus'
}

export function draftsToStops(
  drafts: DraftStop[],
  transport: 'car' | 'transit' | 'taxi',
  places: Record<string, PlaceSummary>,
): Stop[] {
  // 같은 장소를 두 번 들러도 stop key는 자리 순서로만 매긴다 (placeId로 묶지 않는다).
  const coords = drafts.map(draft => {
    const place = draft.placeId === null ? undefined : places[draft.placeId]
    return place?.coord ?? draft.coord
  })

  return drafts.map((draft, index) => {
    const coord = coords[index]
    const arriveBy =
      index === 0
        ? transport === 'transit'
          ? 'bus'
          : transport
        : arriveByFor(transport, coords[index - 1], coord)

    return {
      key: `s${index + 1}`,
      placeId: draft.placeId,
      name: draft.name,
      ...(coord !== undefined ? { coord } : {}),
      ...(draft.startTime !== undefined ? { startTime: draft.startTime } : {}),
      ...(draft.visitMin !== undefined ? { visitMin: draft.visitMin } : {}),
      // 장소 상세가 있으면 그 장소의 seated를 엔진이 쓰므로 초안 값은 버린다.
      ...(draft.placeId === null && draft.seated !== undefined ? { seated: draft.seated } : {}),
      mustVisit: draft.mustVisit ?? false,
      ...(draft.reservedAt !== undefined ? { reservedAt: draft.reservedAt } : {}),
      arriveBy,
      skipSegmentIds: [],
      detourMap: {},
      restNodeIds: [],
    } satisfies Stop
  })
}
