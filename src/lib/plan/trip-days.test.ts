import { describe, expect, it } from 'vitest'
import type { PlaceSummary, Stop } from '@/lib/contracts'
import { addStopToDay, dayDate, moveStopInDay, newStopForDay, replaceDayStops, tripDayList } from './trip-days'

function stop(key: string, day?: number, startTime?: string): Stop {
  return {
    key,
    placeId: null,
    name: key,
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...(day !== undefined ? { day } : {}),
    ...(startTime !== undefined ? { startTime } : {}),
  }
}

const keys = (stops: Stop[]) => stops.map(s => `${s.key}:${s.day ?? 1}`)

describe('tripDayList (날짜 탭)', () => {
  it('하루짜리 여행은 [1] — 탭이 보이지 않는다', () => {
    expect(tripDayList({ date: '2026-11-14' }, [stop('a'), stop('b')])).toEqual([1])
    expect(tripDayList({}, [])).toEqual([1])
  })
  it('시작~끝 날짜만큼 날이 생기고, 장소가 없는 날도 탭에 나온다', () => {
    expect(tripDayList({ date: '2026-11-14', endDate: '2026-11-16' }, [stop('a')])).toEqual([1, 2, 3])
  })
  it('월이 바뀌어도 날 수를 맞게 센다', () => {
    expect(tripDayList({ date: '2026-11-30', endDate: '2026-12-01' }, [])).toEqual([1, 2])
  })
  it('날짜 범위 밖에 장소가 있으면 그 날도 보인다 (지우지 않게)', () => {
    expect(tripDayList({ date: '2026-11-14' }, [stop('a'), stop('b', 3)])).toEqual([1, 3])
  })
  it('끝 날짜가 시작보다 빠르거나 형식이 틀리면 하루로 본다', () => {
    expect(tripDayList({ date: '2026-11-14', endDate: '2026-11-13' }, [])).toEqual([1])
    expect(tripDayList({ date: '2026-11-14', endDate: 'nope' }, [])).toEqual([1])
  })
  it('터무니없이 긴 기간은 탭 수를 줄인다', () => {
    expect(tripDayList({ date: '2026-01-01', endDate: '2026-12-31' }, [])).toHaveLength(30)
  })
})

describe('dayDate', () => {
  it('시작일에서 day-1일 뒤', () => {
    expect(dayDate('2026-11-30', 2)).toBe('2026-12-01')
    expect(dayDate('2026-11-14', 1)).toBe('2026-11-14')
  })
  it('시작일을 모르면 null', () => {
    expect(dayDate(null, 2)).toBeNull()
    expect(dayDate(undefined, 1)).toBeNull()
  })
})

describe('replaceDayStops (빠른 수정안은 그날 장소만 돌려준다)', () => {
  const all = [stop('a1'), stop('a2'), stop('b1', 2), stop('b2', 2), stop('c1', 3)]
  it('그날 부분만 바꿔 끼우고 다른 날은 그대로 둔다', () => {
    const out = replaceDayStops(all, 2, [stop('b2', 2), stop('x', 2)])
    expect(keys(out)).toEqual(['a1:1', 'a2:1', 'b2:2', 'x:2', 'c1:3'])
  })
  it('바꿔 끼우는 장소에 day가 빠져 있으면 그날을 붙인다', () => {
    const out = replaceDayStops(all, 3, [stop('y')])
    expect(keys(out)).toEqual(['a1:1', 'a2:1', 'b1:2', 'b2:2', 'y:3'])
  })
  it('1일차는 day 칸 없이 두어 기존 데이터 모양을 바꾸지 않는다', () => {
    const out = replaceDayStops(all, 1, [stop('z')])
    expect(out[0]).not.toHaveProperty('day')
  })
  it('비어 있던 날은 날짜 순서에 맞는 자리에 넣는다', () => {
    const out = replaceDayStops([stop('a1'), stop('c1', 3)], 2, [stop('n')])
    expect(keys(out)).toEqual(['a1:1', 'n:2', 'c1:3'])
  })
  it('하루짜리 일정은 통째로 바뀐다 (지금 동작과 같다)', () => {
    const out = replaceDayStops([stop('a'), stop('b')], 1, [stop('b'), stop('a')])
    expect(keys(out)).toEqual(['b:1', 'a:1'])
  })
})

describe('moveStopInDay (목록에는 그날 장소만 보인다)', () => {
  it('그날 안에서의 순서 번호로 옮기고 다른 날은 건드리지 않는다', () => {
    const all = [stop('a1'), stop('b1', 2), stop('a2'), stop('b2', 2)]
    const out = moveStopInDay(all, 2, 1, -1)
    expect(keys(out).filter(k => k.endsWith(':2'))).toEqual(['b2:2', 'b1:2'])
    expect(keys(out).filter(k => k.endsWith(':1'))).toEqual(['a1:1', 'a2:1'])
  })
  it('그날 맨 위에서 위로는 그대로', () => {
    const all = [stop('a1'), stop('b1', 2)]
    expect(moveStopInDay(all, 2, 0, -1)).toEqual(all)
  })
})

describe('장소 더하기', () => {
  const place: PlaceSummary = {
    id: 'hanbat',
    name: '한밭수목원',
    category: '공원',
    styles: [],
    coord: [127.38, 36.36],
    seated: false,
    indoor: false,
    confidence: 'A',
    visitMin: 60,
  }
  it('키는 모든 날에서 겹치지 않고, 시작 시각은 그날 마지막 장소 뒤로 잇는다', () => {
    const all = [stop('s-hanbat-1', 1, '09:00'), stop('b1', 2, '10:00')]
    const created = newStopForDay(place, all, 2, 'car')
    expect(created.key).toBe('s-hanbat-2')
    expect(created.day).toBe(2)
    // 2일차 10:00 + 머문 시간 60분(기본) + 이동 여유 20분
    expect(created.startTime).toBe('11:20')
  })
  it('그날에 시간이 있는 장소가 없으면 시각을 지어내지 않는다', () => {
    const created = newStopForDay(place, [stop('a1', 1, '09:00')], 2, 'car')
    expect(created.startTime).toBeUndefined()
  })
  it('1일차에 더하면 day 칸 없이, 그날 맨 뒤에 붙는다', () => {
    const all = [stop('a1'), stop('b1', 2)]
    const created = newStopForDay(place, all, 1, 'car')
    expect(created).not.toHaveProperty('day')
    expect(keys(addStopToDay(all, 1, created))).toEqual(['a1:1', 's-hanbat-1:1', 'b1:2'])
  })
})
