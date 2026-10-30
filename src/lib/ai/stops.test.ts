// AI가 고른 자리 → Stop[] 바꾸기 검사. 순수 함수라 외부 호출이 없다.
import { describe, expect, it } from 'vitest'
import { StopSchema, type Coord, type PlaceSummary } from '@/lib/contracts'
import { arriveByFor, draftsToStops } from './stops'

// 위도 1도는 약 111,195 m — 경계(700 m) 검사를 위해 같은 경도에서 위도만 바꾼다.
const M_PER_DEG_LAT = (Math.PI / 180) * 6371000
const ORIGIN: Coord = [127.38, 36.35]

function north(meters: number): Coord {
  return [ORIGIN[0], ORIGIN[1] + meters / M_PER_DEG_LAT]
}

const hanbat: PlaceSummary = {
  id: 'hanbat',
  name: '한밭수목원',
  category: '수목원',
  styles: ['자연·산책'],
  coord: ORIGIN,
  visitMin: 90,
  seated: false,
  indoor: false,
  source: '테스트',
  checkedAt: '2026-10-30',
  confidence: 'C',
}

const places: Record<string, PlaceSummary> = { hanbat }

describe('arriveByFor', () => {
  it('arriveByFor 700 m 경계(699·701 m)', () => {
    expect(arriveByFor('transit', ORIGIN, north(699))).toBe('walk')
    expect(arriveByFor('transit', ORIGIN, north(701))).toBe('bus')
    // 좌표를 모르면 대중교통은 버스로 둔다 (걷는 시간을 지어내지 않기 위해)
    expect(arriveByFor('transit', ORIGIN, undefined)).toBe('bus')
    expect(arriveByFor('transit', undefined, undefined)).toBe('bus')
  })

  it('자가용·택시는 그대로', () => {
    expect(arriveByFor('car', ORIGIN, north(5000))).toBe('car')
    expect(arriveByFor('taxi', undefined, undefined)).toBe('taxi')
  })
})

describe('draftsToStops', () => {
  it('draftsToStops 키·첫 장소 bus', () => {
    const stops = draftsToStops(
      [
        { placeId: 'hanbat', name: '한밭수목원', startTime: '10:00', visitMin: 60, mustVisit: true },
        { placeId: null, name: '점심', seated: true, coord: north(300), mustVisit: false },
        { placeId: null, name: '먼 곳', coord: north(2000) },
      ],
      'transit',
      places,
    )

    expect(stops.map(stop => stop.key)).toEqual(['s1', 's2', 's3'])
    // 대중교통이어도 첫 장소는 정류장에서 내리므로 버스다
    expect(stops[0].arriveBy).toBe('bus')
    expect(stops[1].arriveBy).toBe('walk')
    expect(stops[2].arriveBy).toBe('bus')
    expect(stops[0].coord).toEqual(ORIGIN)
    expect(stops[0].seated).toBeUndefined()
    expect(stops[1].seated).toBe(true)
    expect(stops[2].seated).toBeUndefined()
    expect(stops[0]).toMatchObject({
      placeId: 'hanbat',
      name: '한밭수목원',
      startTime: '10:00',
      visitMin: 60,
      mustVisit: true,
      skipSegmentIds: [],
      detourMap: {},
      restNodeIds: [],
    })
    for (const stop of stops) StopSchema.parse(stop)
  })

  it('장소 좌표가 초안 좌표보다 먼저', () => {
    const stops = draftsToStops(
      [
        { placeId: 'hanbat', name: '한밭수목원', coord: north(5000) },
        { placeId: null, name: '가까운 곳', coord: north(100) },
      ],
      'taxi',
      places,
    )
    expect(stops[0].coord).toEqual(ORIGIN)
    expect(stops[0].arriveBy).toBe('taxi')
    expect(stops[1].arriveBy).toBe('taxi')
  })

  it('정확히 700 m → walk', () => {
    expect(arriveByFor('transit', ORIGIN, north(700))).toBe('walk')
  })

  it('상세 있는 장소의 seated 초안은 무시', () => {
    const stops = draftsToStops([{ placeId: 'hanbat', name: '한밭수목원', seated: true }], 'car', places)
    expect(stops[0].seated).toBeUndefined()
    StopSchema.parse(stops[0])
  })
})
