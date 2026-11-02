import { describe, expect, it } from 'vitest'
import {
  CreateTripRequestSchema,
  InterviewFilledSchema,
  StopSchema,
  stopDay,
  stopsOfDay,
  tripDays,
  UpdateTripRequestSchema,
  type Stop,
} from './index'

const stop: Stop = {
  key: 's1',
  placeId: 'hanbat',
  name: '한밭수목원',
  startTime: '10:00',
  visitMin: 90,
  mustVisit: true,
  arriveBy: 'car',
  skipSegmentIds: [],
  detourMap: {},
  restNodeIds: [],
}

describe('여러 날 여행: 장소의 날짜', () => {
  it('day 없는 기존 장소는 1일차', () => {
    expect(stopDay({})).toBe(1)
    expect(stopDay({ day: 2 })).toBe(2)
    expect(StopSchema.safeParse({ ...stop, day: 0 }).success).toBe(false)
  })

  it('day 없이 저장된 기존 장소 모양이 그대로 통과한다', () => {
    expect(StopSchema.safeParse(stop).success).toBe(true)
    expect(StopSchema.safeParse({ ...stop, day: 3 }).success).toBe(true)
    expect(StopSchema.safeParse({ ...stop, day: 1.5 }).success).toBe(false)
  })

  it('날짜별로 나누고 순서를 지킨다', () => {
    const stops = [{ ...stop, key: 'a' }, { ...stop, key: 'b', day: 2 }, { ...stop, key: 'c', day: 1 }]
    expect(stopsOfDay(stops, 1).map(s => s.key)).toEqual(['a', 'c'])
    expect(stopsOfDay(stops, 2).map(s => s.key)).toEqual(['b'])
    expect(stopsOfDay(stops, 3)).toEqual([])
    expect(tripDays(stops)).toEqual([1, 2])
    expect(tripDays([])).toEqual([])
  })

  it('나오는 날짜 번호는 오름차순에 중복이 없다', () => {
    expect(tripDays([{ day: 3 }, {}, { day: 3 }, { day: 2 }])).toEqual([1, 2, 3])
  })
})

describe('여러 날 여행: 끝 날짜', () => {
  const base = { groupId: 'g1', title: '대전 1박 2일', mode: 'scratch' }

  it('끝 날짜가 시작보다 빠르면 거부, 같거나 늦으면 통과', () => {
    expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14', endDate: '2026-11-13' }).success).toBe(false)
    expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14', endDate: '2026-11-15' }).success).toBe(true)
    expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14', endDate: '2026-11-14' }).success).toBe(true)
    expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14' }).success).toBe(true)
  })

  it('거부 메시지는 끝 날짜 칸에 붙는다', () => {
    const result = CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14', endDate: '2026-11-13' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]).toMatchObject({ message: '끝 날짜가 시작 날짜보다 빨라요', path: ['endDate'] })
  })

  it('끝 날짜만 있거나 비어 있어도 통과, 없는 날짜는 거부', () => {
    expect(CreateTripRequestSchema.safeParse({ ...base, endDate: '2026-11-15' }).success).toBe(true)
    expect(CreateTripRequestSchema.safeParse({ ...base, date: null, endDate: null }).success).toBe(true)
    expect(CreateTripRequestSchema.safeParse({ ...base, endDate: '2026-02-31' }).success).toBe(false)
  })

  it('수정 요청도 둘 다 보냈을 때만 비교한다', () => {
    expect(UpdateTripRequestSchema.safeParse({ date: '2026-11-14', endDate: '2026-11-13' }).success).toBe(false)
    expect(UpdateTripRequestSchema.safeParse({ date: '2026-11-14', endDate: '2026-11-15' }).success).toBe(true)
    // 한쪽만 오면 저장된 여행과의 비교는 서버가 한다
    expect(UpdateTripRequestSchema.safeParse({ endDate: '2026-11-13' }).success).toBe(true)
    expect(UpdateTripRequestSchema.safeParse({ date: '2026-11-14' }).success).toBe(true)
    expect(UpdateTripRequestSchema.safeParse({ date: '2026-11-14', endDate: null }).success).toBe(true)
    expect(UpdateTripRequestSchema.safeParse({ endDate: '2026-02-31' }).success).toBe(false)
  })

  it('인터뷰도 끝 날짜를 받고 없는 날짜는 거부', () => {
    const filled = { mode: 'scratch', travelers: [], styles: [], mustVisit: [], fixTargets: [] }
    expect(InterviewFilledSchema.safeParse({ ...filled, date: '2026-11-14', endDate: '2026-11-15' }).success).toBe(true)
    expect(InterviewFilledSchema.safeParse({ ...filled, endDate: '2026-02-31' }).success).toBe(false)
    expect(InterviewFilledSchema.safeParse(filled).success).toBe(true)
  })
})
