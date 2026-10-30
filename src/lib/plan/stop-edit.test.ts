import { describe, expect, it } from 'vitest'
import type { PlaceSummary, Stop } from '@/lib/contracts'
import { addMinutes, moveStop, newStopKey, nextStartTime, removeStop, replaceStopPlace, sameStops, stopFromPlace, updateStop } from './stop-edit'

const stop = (key: string, extra: Partial<Stop> = {}): Stop => ({
  key, placeId: key, name: key, mustVisit: false, arriveBy: 'car', skipSegmentIds: [], detourMap: {}, restNodeIds: [], ...extra,
})

const place: PlaceSummary = {
  id: 'science', name: '국립중앙과학관', category: '과학관', styles: [], coord: [127.37, 36.37], visitMin: 90,
  seated: false, indoor: true, confidence: 'B',
}

describe('시각 계산', () => {
  it('분을 더하고 하루를 넘기지 않는다', () => {
    expect(addMinutes('09:30', 80)).toBe('10:50')
    expect(addMinutes('23:00', 120)).toBe('23:59')
  })

  it('다음 장소 시작 시각은 마지막 장소가 끝난 뒤 20분 여유', () => {
    expect(nextStartTime([stop('a', { startTime: '09:00', visitMin: 60 })])).toBe('10:20')
    expect(nextStartTime([stop('a')])).toBeUndefined()
    expect(nextStartTime([])).toBeUndefined()
  })
})

describe('장소 더하기·바꾸기·빼기', () => {
  it('같은 장소를 또 넣어도 키가 겹치지 않는다', () => {
    const first = stopFromPlace(place, [], 'taxi')
    const second = stopFromPlace(place, [first])
    expect(first.key).toBe('s-science-1')
    expect(second.key).toBe('s-science-2')
    expect(first.arriveBy).toBe('taxi')
    expect(first.visitMin).toBe(90)
    expect(newStopKey([first, second], 'science')).toBe('s-science-3')
  })

  it('순서를 바꾸고 처음·끝에서는 그대로 둔다', () => {
    const stops = [stop('a'), stop('b'), stop('c')]
    expect(moveStop(stops, 1, -1).map(s => s.key)).toEqual(['b', 'a', 'c'])
    expect(moveStop(stops, 1, 1).map(s => s.key)).toEqual(['a', 'c', 'b'])
    expect(moveStop(stops, 0, -1)).toBe(stops)
    expect(moveStop(stops, 2, 1)).toBe(stops)
  })

  it('빼기', () => {
    expect(removeStop([stop('a'), stop('b')], 'a').map(s => s.key)).toEqual(['b'])
  })

  it('장소를 바꾸면 시각·이동수단은 두고 길에 묶인 설정은 비운다', () => {
    const before = stop('a', { startTime: '10:00', arriveBy: 'taxi', mustVisit: true, detourMap: { s3: 's3d' }, restNodeIds: ['R'], skipSegmentIds: ['s5'] })
    const [after] = replaceStopPlace([before], 'a', place)
    expect(after).toMatchObject({ key: 'a', placeId: 'science', name: '국립중앙과학관', startTime: '10:00', arriveBy: 'taxi', mustVisit: true, visitMin: 90 })
    expect(after.detourMap).toEqual({})
    expect(after.restNodeIds).toEqual([])
    expect(after.skipSegmentIds).toEqual([])
  })

  it('한 장소의 값만 고치고 나머지는 그대로', () => {
    const stops = [stop('a'), stop('b')]
    const next = updateStop(stops, 'b', { startTime: '11:00' })
    expect(next[1].startTime).toBe('11:00')
    expect(next[0]).toBe(stops[0])
  })

  it('같은 일정인지 비교한다', () => {
    expect(sameStops([stop('a')], [stop('a')])).toBe(true)
    expect(sameStops([stop('a')], [stop('a', { mustVisit: true })])).toBe(false)
  })
})
