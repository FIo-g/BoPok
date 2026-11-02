// 여러 날 여행에서 일정 화면이 쓰는 순수 함수들 (설계 2026-11-02 6.5).
// 화면에는 고른 날의 장소만 보이지만, 저장하는 버전에는 모든 날이 들어 있다 —
// 그래서 그날 부분만 바꿔 끼우는 함수를 거쳐야 다른 날 일정이 지워지지 않는다.
import { stopDay, stopsOfDay, type PlaceSummary, type Stop, type Trip, type Transport } from '@/lib/contracts'
import { moveStop, nextStartTime, stopFromPlace } from './stop-edit'

// 날짜 범위가 터무니없이 길어도(입력 실수) 탭이 화면을 덮지 않게 한다 [빌더]
export const TRIP_DAY_TABS_MAX = 30

const DAY_MS = 24 * 60 * 60 * 1000

function utcDay(ymd: string): number | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// 시작~끝 날짜의 날 수(둘 다 포함). 모르거나 순서가 틀리면 1
function rangeDays(date?: string | null, endDate?: string | null): number {
  if (!date || !endDate) return 1
  const start = utcDay(date)
  const end = utcDay(endDate)
  if (start === null || end === null || end < start) return 1
  return Math.min(TRIP_DAY_TABS_MAX, Math.round((end - start) / DAY_MS) + 1)
}

// 날짜 탭 목록: 여행 기간의 모든 날 + 일정에 장소가 있는 날. 장소가 없는 날도 탭에 나오고,
// 기간 밖에 남은 장소가 있으면 그 날도 보여서 지워지지 않는다. 하루짜리 여행이면 [1]
export function tripDayList(trip: Partial<Pick<Trip, 'date' | 'endDate'>>, stops: Pick<Stop, 'day'>[]): number[] {
  const days = new Set<number>([1])
  for (let day = 1; day <= rangeDays(trip.date, trip.endDate); day += 1) days.add(day)
  for (const stop of stops) days.add(stopDay(stop))
  return [...days].sort((a, b) => a - b)
}

// 그날의 날짜 'YYYY-MM-DD'. 시작일을 모르면 null
export function dayDate(startDate: string | null | undefined, day: number): string | null {
  const start = startDate ? utcDay(startDate) : null
  if (start === null) return null
  return new Date(start + (day - 1) * DAY_MS).toISOString().slice(0, 10)
}

// 1일차는 day 칸 없이 둔다 — 지금까지 저장된 하루 일정과 모양이 같아야 비교(sameStops)·저장이 그대로 돈다
function withDay(stop: Stop, day: number): Stop {
  if (day !== 1) return { ...stop, day }
  if (stop.day === undefined) return stop
  const out = { ...stop }
  delete out.day
  return out
}

// 그날 장소를 dayStops로 바꿔 끼운다. 원래 그날이 있던 자리에 넣고, 비어 있던 날이면 날짜 순서에 맞는 자리에 넣는다
export function replaceDayStops(all: Stop[], day: number, dayStops: Stop[]): Stop[] {
  const others = all.filter(stop => stopDay(stop) !== day)
  const firstOfDay = all.findIndex(stop => stopDay(stop) === day)
  const at =
    firstOfDay >= 0
      ? all.slice(0, firstOfDay).filter(stop => stopDay(stop) !== day).length
      : (() => {
          const later = others.findIndex(stop => stopDay(stop) > day)
          return later >= 0 ? later : others.length
        })()
  return [...others.slice(0, at), ...dayStops.map(stop => withDay(stop, day)), ...others.slice(at)]
}

// 목록의 순서 번호는 그날 안의 번호다. 그날 안에서만 옮긴다
export function moveStopInDay(all: Stop[], day: number, dayIndex: number, delta: -1 | 1): Stop[] {
  const dayStops = stopsOfDay(all, day)
  const moved = moveStop(dayStops, dayIndex, delta)
  return moved === dayStops ? all : replaceDayStops(all, day, moved)
}

// 장소 하나를 그날 맨 뒤에 더한다
export function addStopToDay(all: Stop[], day: number, stop: Stop): Stop[] {
  return replaceDayStops(all, day, [...stopsOfDay(all, day), stop])
}

// 더할 장소: 키는 모든 날에서 겹치지 않게, 시작 시각은 그날 마지막 장소 뒤로 잇는다(그날에 시각이 없으면 지어내지 않는다)
export function newStopForDay(place: PlaceSummary, all: Stop[], day: number, arriveBy: Transport): Stop {
  const base = stopFromPlace(place, all, arriveBy)
  const startTime = nextStartTime(stopsOfDay(all, day))
  const out: Stop = { ...base }
  if (startTime === undefined) delete out.startTime
  else out.startTime = startTime
  return withDay(out, day)
}
