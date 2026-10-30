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
  // 다시 짜기에서 그대로 남은 장소의 설정을 옮기는 칸 (revise만 채운다 — 없으면 빈 값).
  skipSegmentIds?: string[]
  detourMap?: Record<string, string>
  restNodeIds?: string[]
}

// 공백을 뺀 뒤 한쪽이 다른 쪽을 포함하면 같은 곳으로 본다 (예: 성심당·성심당 본점).
export function samePlaceName(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, '')
  const nb = b.replace(/\s+/g, '')
  if (na.length === 0 || nb.length === 0) return false
  return na.includes(nb) || nb.includes(na)
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
      // revise가 옮겨 온 설정이 있으면 쓰고, 없으면 빈 값 (generate는 항상 빈 값).
      skipSegmentIds: draft.skipSegmentIds ?? [],
      detourMap: draft.detourMap ?? {},
      restNodeIds: draft.restNodeIds ?? [],
    } satisfies Stop
  })
}

// 초안과 원래 꼭 갈 곳·예약이 같은 곳인지 본다.
// placeId가 양쪽에 있으면 id로 먼저 맞추고, 아니면 공백을 뺀 이름 포함으로 본다.
function matchesMust(must: DraftStop, draft: DraftStop): boolean {
  if (must.placeId !== null && draft.placeId !== null) {
    if (must.placeId === draft.placeId) return true
    return samePlaceName(draft.name, must.name)
  }
  return samePlaceName(draft.name, must.name)
}

function timeKey(draft: DraftStop): string | undefined {
  return draft.reservedAt ?? draft.startTime
}

// AI 초안에 원래 꼭 갈 곳·예약 표시를 되돌린다 (generate·revise 공통, 설계 6.4).
// 같은 장소를 여러 번 들르면 순서대로 짝짓는다 — 쓴 초안은 다시 쓰지 않는다.
export function enforceMustStops(
  drafts: DraftStop[],
  mustStops: DraftStop[],
): { drafts: DraftStop[]; missing: DraftStop[] } {
  const used = new Array<boolean>(drafts.length).fill(false)
  const out = drafts.map(draft => ({ ...draft }))
  const missing: DraftStop[] = []
  for (const must of mustStops) {
    const index = out.findIndex((draft, i) => !used[i] && matchesMust(must, draft))
    if (index < 0) {
      // 짝이 없으면 아직 넣지 않는다 — revise가 한 번 더 묻고 그래도 빠지면 되돌려 넣는다.
      missing.push({ ...must })
      continue
    }
    used[index] = true
    const draft = out[index]!
    draft.mustVisit = must.mustVisit ?? true
    if (must.reservedAt !== undefined) {
      draft.reservedAt = must.reservedAt
      draft.startTime = must.reservedAt
    } else {
      delete draft.reservedAt
    }
  }
  return { drafts: out, missing }
}

// 빠진 꼭 갈 곳을 예약 시간 순서에 맞는 자리에 끼워 넣는다 (맨 뒤에 붙이지 않는다, 중복 없음).
// 시간이 없으면 원래 일정에서의 앞 stop 바로 뒤에 넣는다 — original은 원래 일정 순서의 초안들이다.
export function restoreMustStops(
  drafts: DraftStop[],
  missing: DraftStop[],
  original?: DraftStop[],
): DraftStop[] {
  const out = [...drafts]
  // 원래 일정에서 miss의 자리를 찾는다 — 같은 값의 stop을 앞에서부터 순서대로 소모한다.
  const consumed = new Array<boolean>(original?.length ?? 0).fill(false)
  for (const miss of missing) {
    if (out.some(draft => matchesMust(miss, draft))) continue
    const key = timeKey(miss)
    if (key !== undefined) {
      const at = out.findIndex(draft => {
        const other = timeKey(draft)
        return other !== undefined && other > key
      })
      if (at >= 0) out.splice(at, 0, { ...miss })
      else out.push({ ...miss })
      continue
    }
    const anchor = original === undefined ? -1 : anchorAfter(out, original, consumed, miss)
    if (anchor >= 0) out.splice(anchor, 0, { ...miss })
    else out.push({ ...miss })
  }
  return out
}

// 원래 일정에서 miss의 앞 stop 중 지금 초안에 있는 가장 뒤의 것 바로 뒤 자리.
// 뒤쪽에 있는 것이 초안에 있으면 그 앞 자리. 없으면 -1.
function anchorAfter(
  out: DraftStop[],
  original: DraftStop[],
  consumed: boolean[],
  miss: DraftStop,
): number {
  const self = original.findIndex(
    (stop, i) =>
      !consumed[i] &&
      stop.placeId === miss.placeId &&
      stop.name === miss.name &&
      stop.reservedAt === miss.reservedAt &&
      stop.startTime === miss.startTime,
  )
  if (self < 0) return -1
  consumed[self] = true
  for (let i = self - 1; i >= 0; i--) {
    const at = out.findIndex(draft => matchesMust(original[i]!, draft))
    if (at >= 0) return at + 1
  }
  for (let i = self + 1; i < original.length; i++) {
    const at = out.findIndex(draft => matchesMust(original[i]!, draft))
    if (at >= 0) return at
  }
  return -1
}
