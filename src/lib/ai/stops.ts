// AI가 고른 자리(초안) → 일정의 Stop[]. 장소 상세와 좌표를 아는 만큼만 채운다.
// 이동수단은 여기서 정하지만 걷는 시간·거리는 엔진 밖에서 만들지 않는다 (설계 7.3.1).
import 'server-only'
import type { Coord, PlaceSummary, Stop, Transport } from '@/lib/contracts'

export type DraftStop = {
  placeId: string | null
  name: string
  day?: number // 몇째 날. 여러 날 일정을 다시 짤 때만 쓴다 (없으면 1일차)
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

// 여행 출발~귀가 시간대. 인터뷰에서 정한 값이고, 모르면 비워 둔다.
export type TimeWindow = { startTime?: string; endTime?: string }

// HH:mm은 글자 순서가 시간 순서와 같아 문자열로 비교한다. 경계는 포함, 모르는 쪽은 보지 않는다.
export function isWithinWindow(time: string, window: TimeWindow): boolean {
  if (window.startTime !== undefined && time < window.startTime) return false
  if (window.endTime !== undefined && time > window.endTime) return false
  return true
}

// AI가 시간을 모를 때 00:00 같은 빈자리 값을 채우는 일이 있다 (데모 버그 11/2: 성심당 00:00).
// 시간대 밖 시간은 지우고 장소는 남긴다 — 화면에는 '시간 미정'으로 보인다.
// 예약 자리(reservedAt)와 keep이 참인 자리(사람이 정해 둔 시간)는 건드리지 않는다.
export function dropTimesOutsideWindow(
  drafts: DraftStop[],
  window: TimeWindow,
  keep?: (draft: DraftStop) => boolean,
): DraftStop[] {
  return drafts.map(draft => {
    if (draft.startTime === undefined || draft.reservedAt !== undefined) return draft
    if (isWithinWindow(draft.startTime, window) || keep?.(draft)) return draft
    const out = { ...draft }
    delete out.startTime
    return out
  })
}

// 인터뷰에서 AI가 뽑은 꼭 갈 곳의 예약 시간도 같은 이유로 시간대 밖이면 버린다 (장소는 남긴다).
export function mustVisitWithinWindow<T extends { reservedAt?: string }>(musts: T[], window: TimeWindow): T[] {
  return musts.map(must => {
    if (must.reservedAt === undefined || isWithinWindow(must.reservedAt, window)) return must
    const out = { ...must }
    delete out.reservedAt
    return out
  })
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
    // 그날 첫 장소는 앞 장소에서 이어지는 길이 없다 — 전날 마지막 장소와의 거리로 고르지 않는다
    const startsDay = index === 0 || (draft.day ?? 1) !== (drafts[index - 1]!.day ?? 1)
    const arriveBy =
      startsDay
        ? transport === 'transit'
          ? 'bus'
          : transport
        : arriveByFor(transport, coords[index - 1], coord)

    return {
      key: `s${index + 1}`,
      placeId: draft.placeId,
      name: draft.name,
      // 1일차는 칸을 두지 않는다 — 지금까지 저장된 하루 일정과 모양이 같아야 한다
      ...(draft.day !== undefined && draft.day !== 1 ? { day: draft.day } : {}),
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

// 여러 날 일정의 초안을 날짜 순서로 놓는다. AI가 날을 안 주면 앞 장소와 같은 날로,
// 없는 날을 주면 마지막 날로 둔다 (날을 새로 만들지 않는다). 같은 날 안의 순서는 그대로다.
export function arrangeDraftsByDay(drafts: DraftStop[], lastDay: number): DraftStop[] {
  let current = 1
  const placed = drafts.map(draft => {
    current = Math.min(draft.day ?? current, lastDay)
    return { ...draft, day: current }
  })
  return placed
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => a.draft.day - b.draft.day || a.index - b.index)
    .map(({ draft }) => draft)
}

// AI가 어떤 날을 통째로 빼면 그날을 되살린다. 프롬프트로 부탁해도 '바꿀 날만' 답할 수 있어서
// 코드로 막는다. 다른 날로 옮겨 둔 장소는 원래 날로 돌리고, 없어진 장소는 원래 값으로 넣는다.
export function keepEveryDay(
  drafts: DraftStop[],
  days: { day: number; drafts: DraftStop[] }[],
  samePlace: (original: DraftStop, draft: DraftStop) => boolean,
): DraftStop[] {
  const out = drafts.map(draft => ({ ...draft }))
  for (const { day, drafts: originals } of days) {
    if (out.some(draft => draft.day === day)) continue
    for (const original of originals) {
      const moved = out.find(draft => draft.day !== day && samePlace(original, draft))
      if (moved) moved.day = day
      else out.push({ ...original, day })
    }
  }
  return out
}

// 초안과 원래 꼭 갈 곳·예약이 같은 곳인지 본다.
// 꼭 갈 곳이 DB 장소면 같은 id끼리만 짝짓는다 (비슷한 이름의 다른 자리로 바뀌지 않게).
// placeId가 없을 때만 이름 포함으로 본다.
function matchesMust(must: DraftStop, draft: DraftStop): boolean {
  if (must.placeId !== null) {
    return draft.placeId !== null && draft.placeId === must.placeId
  }
  return samePlaceName(draft.name, must.name)
}

// 꼭 갈 곳이 정해진 날과 같은 날의 초안인지. 날이 없는 꼭 갈 곳(generate)은 어느 초안과도 같다고 본다
function onSameDay(must: DraftStop, draft: DraftStop): boolean {
  return must.day === undefined || (draft.day ?? 1) === must.day
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
    // 같은 장소를 여러 날 들르면 예약이 다른 날 방문에 붙지 않게 같은 날부터 찾는다
    const sameDay = out.findIndex((draft, i) => !used[i] && matchesMust(must, draft) && onSameDay(must, draft))
    const index = sameDay >= 0 ? sameDay : out.findIndex((draft, i) => !used[i] && matchesMust(must, draft))
    if (index < 0) {
      // 짝이 없으면 아직 넣지 않는다 — revise가 한 번 더 묻고 그래도 빠지면 되돌려 넣는다.
      missing.push({ ...must })
      continue
    }
    used[index] = true
    const draft = out[index]!
    draft.mustVisit = must.mustVisit ?? true
    // 꼭 갈 곳·예약은 날도 그대로 둔다 (예약은 그날에만 유효하다)
    if (must.day !== undefined) draft.day = must.day
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
    if (out.some(draft => matchesMust(miss, draft) && onSameDay(miss, draft))) continue
    const key = timeKey(miss)
    if (key !== undefined) {
      // 시간은 그날 안에서만 비교한다 — 전날 오후 일정 앞에 끼워지지 않게
      const at = out.findIndex(draft => {
        const other = timeKey(draft)
        return onSameDay(miss, draft) && other !== undefined && other > key
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
