import { describe, expect, it } from 'vitest'
import type { Stop, Traveler } from '@/lib/contracts'
import { applyTuned, cleanTuned, isTuned } from './tuned'

const traveler = (id: string, extra: Partial<Traveler> = {}): Traveler => ({ id, label: id, pace: 'unknown', mobilityAid: false, isParent: false, condition: {}, filledBySelf: false, ...extra })
const stop = (key: string, extra: Partial<Stop> = {}): Stop => ({ key, placeId: key, name: key, mustVisit: false, arriveBy: 'car', skipSegmentIds: [], detourMap: {}, restNodeIds: [], ...extra })

describe('조건 바꿔 보기 값', () => {
  it('바꾼 게 없으면 바꿔 보는 중이 아니다', () => {
    expect(isTuned(undefined)).toBe(false)
    expect(isTuned({})).toBe(false)
    expect(isTuned({ condition: {} })).toBe(false)
    expect(isTuned({ mobilityAid: false })).toBe(true)
    expect(isTuned({ condition: { dayMin: 60 } })).toBe(true)
  })

  it('cleanTuned 는 빈 값을 지우고 모두 비면 undefined', () => {
    expect(cleanTuned({ condition: {}, pace: undefined })).toBeUndefined()
    expect(cleanTuned({ condition: {}, transport: 'taxi' })).toEqual({ transport: 'taxi' })
  })

  it('걷는 속도·보조기구는 모든 여행자에, 이동수단은 모든 장소에 적용하고 원본은 그대로', () => {
    const travelers = [traveler('a', { pace: 'normal' }), traveler('b')]
    const stops = [stop('s1'), stop('s2')]
    const applied = applyTuned(travelers, stops, { pace: 'slow', mobilityAid: true, transport: 'bus' })
    expect(applied.travelers.map(t => [t.pace, t.mobilityAid])).toEqual([['slow', true], ['slow', true]])
    expect(applied.stops.map(s => s.arriveBy)).toEqual(['bus', 'bus'])
    expect(travelers[0].pace).toBe('normal')
    expect(stops[0].arriveBy).toBe('car')
  })

  it('걷기 조건만 바꾸면 여행자·일정은 같은 값(참조)을 그대로 돌려준다', () => {
    const travelers = [traveler('a')]
    const stops = [stop('s1')]
    const applied = applyTuned(travelers, stops, { condition: { dayMin: 60 } })
    expect(applied.travelers).toBe(travelers)
    expect(applied.stops).toBe(stops)
  })
})
