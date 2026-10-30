// 직접 고치기: 일정(stops)을 바꾸는 순수 함수들. 화면 상태와 분리해서 테스트한다.
// 판정·걷는 시간은 여기서 계산하지 않는다 — 바뀐 stops 를 엔진(judge)에 다시 넣으면 된다 (AGENTS.md 6장).
import type { PlaceSummary, Stop, Transport } from '@/lib/contracts'

export const GAP_BETWEEN_STOPS_MIN = 20

// 'HH:mm' + 분 → 'HH:mm' (하루 안에서만 이어 붙이고 넘치면 23:59)
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + Math.round(minutes)))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// 새 장소를 마지막에 붙일 때 쓸 시작 시각: 마지막 장소가 끝난 뒤 + 이동 여유
export function nextStartTime(stops: Stop[]): string | undefined {
  const last = [...stops].reverse().find(stop => stop.startTime)
  if (!last?.startTime) return undefined
  return addMinutes(last.startTime, (last.visitMin ?? 60) + GAP_BETWEEN_STOPS_MIN)
}

// 버전 안에서 겹치지 않는 장소 키
export function newStopKey(stops: Stop[], base: string): string {
  const keys = new Set(stops.map(stop => stop.key))
  let n = 1
  while (keys.has(`s-${base}-${n}`)) n += 1
  return `s-${base}-${n}`
}

export function stopFromPlace(place: PlaceSummary, stops: Stop[], arriveBy: Transport = 'car'): Stop {
  return {
    key: newStopKey(stops, place.id),
    placeId: place.id,
    name: place.name,
    startTime: nextStartTime(stops),
    visitMin: place.visitMin,
    mustVisit: false,
    arriveBy,
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
  }
}

export function moveStop(stops: Stop[], index: number, delta: -1 | 1): Stop[] {
  const target = index + delta
  if (index < 0 || index >= stops.length || target < 0 || target >= stops.length) return stops
  const next = [...stops]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function removeStop(stops: Stop[], key: string): Stop[] {
  return stops.filter(stop => stop.key !== key)
}

// 장소를 바꾸면 시각·이동수단·꼭 갈 곳 표시는 그대로 두고, 그 장소 안 길에 묶인 설정(빼기·우회로·쉼터)은 비운다
export function replaceStopPlace(stops: Stop[], key: string, place: PlaceSummary): Stop[] {
  return stops.map(stop =>
    stop.key !== key
      ? stop
      : {
          ...stop,
          placeId: place.id,
          name: place.name,
          coord: undefined,
          visitMin: place.visitMin,
          seated: undefined,
          skipSegmentIds: [],
          detourMap: {},
          restNodeIds: [],
        },
  )
}

export function updateStop(stops: Stop[], key: string, patch: Partial<Stop>): Stop[] {
  return stops.map(stop => (stop.key === key ? { ...stop, ...patch } : stop))
}

export function sameStops(a: Stop[], b: Stop[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
