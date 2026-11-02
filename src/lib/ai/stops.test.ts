// AI가 고른 자리 → Stop[] 바꾸기 검사. 순수 함수라 외부 호출이 없다.
import { describe, expect, it } from 'vitest'
import { StopSchema, type Coord, type PlaceSummary } from '@/lib/contracts'
import {
  arriveByFor,
  draftsToStops,
  dropTimesOutsideWindow,
  enforceMustStops,
  isWithinWindow,
  mustVisitWithinWindow,
  restoreMustStops,
  samePlaceName,
} from './stops'
import type { DraftStop } from './stops'

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

describe('samePlaceName', () => {
  it('공백을 뺀 뒤 한쪽이 포함되면 같은 곳', () => {
    expect(samePlaceName('성심당 본점', '성심당')).toBe(true)
    expect(samePlaceName('성심 당', '성심당본점')).toBe(true)
    expect(samePlaceName('한밭수목원', '국립중앙과학관')).toBe(false)
    expect(samePlaceName('', '성심당')).toBe(false)
  })
})

describe('enforceMustStops', () => {
  const must = (over: Partial<DraftStop> & { name: string }): DraftStop => ({
    placeId: null,
    mustVisit: true,
    ...over,
  })

  it('placeId로 짝짓고 원래 값으로 덮어쓴다', () => {
    const { drafts, missing } = enforceMustStops(
      [
        { placeId: 'hanbat', name: '한밭수목원', startTime: '16:00' },
        { placeId: 'science', name: '국립중앙과학관' },
      ],
      [must({ placeId: 'hanbat', name: '한밭수목원', reservedAt: '14:00' })],
    )
    expect(missing).toEqual([])
    expect(drafts).toHaveLength(2)
    // 예약이면 startTime도 예약 시간으로 맞춘다
    expect(drafts[0]).toMatchObject({ mustVisit: true, reservedAt: '14:00', startTime: '14:00' })
    expect(drafts[1]).toMatchObject({ placeId: 'science' })
  })

  it('같은 장소를 여러 번 들르면 순서대로 짝짓는다', () => {
    const { drafts, missing } = enforceMustStops(
      [
        { placeId: 'hanbat', name: '한밭수목원', startTime: '10:00' },
        { placeId: 'hanbat', name: '한밭수목원', startTime: '15:00' },
      ],
      [
        must({ placeId: 'hanbat', name: '한밭수목원', reservedAt: '10:00' }),
        must({ placeId: 'hanbat', name: '한밭수목원', reservedAt: '15:00' }),
      ],
    )
    expect(missing).toEqual([])
    expect(drafts[0]).toMatchObject({ startTime: '10:00', reservedAt: '10:00' })
    expect(drafts[1]).toMatchObject({ startTime: '15:00', reservedAt: '15:00' })
  })

  it('placeId가 없으면 이름 포함으로 짝짓는다', () => {
    const { drafts, missing } = enforceMustStops(
      [{ placeId: null, name: '성심당 본점', seated: true }],
      [must({ placeId: null, name: '성심당' })],
    )
    expect(missing).toEqual([])
    expect(drafts[0]).toMatchObject({ mustVisit: true })
  })

  it('짝이 없으면 missing에 넣고 drafts에는 넣지 않는다', () => {
    const { drafts, missing } = enforceMustStops(
      [{ placeId: 'science', name: '국립중앙과학관' }],
      [must({ placeId: 'hanbat', name: '한밭수목원', reservedAt: '14:00' })],
    )
    expect(drafts).toEqual([{ placeId: 'science', name: '국립중앙과학관' }])
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ placeId: 'hanbat', reservedAt: '14:00' })
  })
})

describe('restoreMustStops', () => {
  it('예약 시간 순서 자리에 끼워 넣는다 (맨 뒤가 아님)', () => {
    const out = restoreMustStops(
      [
        { placeId: 'science', name: '국립중앙과학관', startTime: '10:00' },
        { placeId: 'museum', name: '대전시립미술관', startTime: '15:00' },
      ],
      [{ placeId: 'hanbat', name: '한밭수목원', mustVisit: true, reservedAt: '12:00', startTime: '12:00' }],
    )
    expect(out.map(d => d.placeId)).toEqual(['science', 'hanbat', 'museum'])
    expect(out[1]).toMatchObject({ startTime: '12:00', reservedAt: '12:00' })
  })

  it('이미 있으면 중복 없이 하나만', () => {
    const out = restoreMustStops(
      [{ placeId: 'hanbat', name: '한밭수목원', mustVisit: true, reservedAt: '14:00', startTime: '14:00' }],
      [{ placeId: 'hanbat', name: '한밭수목원', mustVisit: true, reservedAt: '14:00', startTime: '14:00' }],
    )
    expect(out.filter(d => d.placeId === 'hanbat')).toHaveLength(1)
  })

  it('시간이 없으면 원래 일정 앞 stop 바로 뒤에 넣는다', () => {
    const original: DraftStop[] = [
      { placeId: 'science', name: '국립중앙과학관' },
      { placeId: 'hanbat', name: '한밭수목원', mustVisit: true },
      { placeId: 'museum', name: '대전시립미술관' },
    ]
    const out = restoreMustStops(
      [
        { placeId: 'science', name: '국립중앙과학관' },
        { placeId: 'museum', name: '대전시립미술관' },
      ],
      [{ placeId: 'hanbat', name: '한밭수목원', mustVisit: true }],
      original,
    )
    expect(out.map(d => d.placeId)).toEqual(['science', 'hanbat', 'museum'])
  })

  it('꼭 갈 곳 한밭수목원(14:00)에 null 벤치는 짝 아님', () => {
    const must: DraftStop = { placeId: 'hanbat', name: '한밭수목원', mustVisit: true, reservedAt: '14:00', startTime: '14:00' }
    const { drafts, missing } = enforceMustStops(
      [{ placeId: null, name: '한밭수목원 앞 벤치', seated: true }],
      [must],
    )
    // placeId가 있으면 같은 id끼리만 짝 — 이름이 비슷해도 짝이 아니다
    expect(missing).toHaveLength(1)
    expect(drafts).toHaveLength(1)
    const restored = restoreMustStops(drafts, missing)
    expect(restored.filter(d => d.placeId === 'hanbat')).toHaveLength(1)
    expect(restored.find(d => d.placeId === 'hanbat')).toMatchObject({ reservedAt: '14:00', startTime: '14:00' })
  })
})

// AI가 시간을 모르면 00:00 같은 빈자리 값을 채우는 일이 있어 여행 시간대 밖 시간은 버린다 (데모 버그 11/2: 성심당 00:00).
describe('여행 시간대 밖 시간 버리기', () => {
  const window = { startTime: '09:00', endTime: '18:00' }

  it('시간대 안이면 받고 밖이면 버림 (경계 포함)', () => {
    expect(isWithinWindow('09:00', window)).toBe(true)
    expect(isWithinWindow('18:00', window)).toBe(true)
    expect(isWithinWindow('12:30', window)).toBe(true)
    expect(isWithinWindow('00:00', window)).toBe(false)
    expect(isWithinWindow('08:59', window)).toBe(false)
    expect(isWithinWindow('18:01', window)).toBe(false)
  })

  it('시간대를 모르면 거르지 않음, 한쪽만 알면 그쪽만 봄', () => {
    expect(isWithinWindow('00:00', {})).toBe(true)
    expect(isWithinWindow('07:00', { startTime: '09:00' })).toBe(false)
    expect(isWithinWindow('20:00', { startTime: '09:00' })).toBe(true)
    expect(isWithinWindow('20:00', { endTime: '18:00' })).toBe(false)
  })

  it('AI가 정한 시간만 지우고 장소는 남김, 예약 자리는 건드리지 않음', () => {
    const drafts: DraftStop[] = [
      { placeId: null, name: '성심당', startTime: '00:00', seated: true },
      { placeId: 'hanbat', name: '한밭수목원', startTime: '10:00' },
      { placeId: 'science', name: '국립중앙과학관', startTime: '19:30', reservedAt: '19:30' },
    ]
    const out = dropTimesOutsideWindow(drafts, window)
    expect(out.map(d => d.name)).toEqual(['성심당', '한밭수목원', '국립중앙과학관'])
    expect(out[0]).not.toHaveProperty('startTime')
    expect(out[1]?.startTime).toBe('10:00')
    expect(out[2]).toMatchObject({ startTime: '19:30', reservedAt: '19:30' })
    // 원래 초안은 바꾸지 않는다
    expect(drafts[0]?.startTime).toBe('00:00')
  })

  it('keep이 참이면 시간대 밖이어도 남김 (사람이 정해 둔 시간)', () => {
    const drafts: DraftStop[] = [{ placeId: 'hanbat', name: '한밭수목원', startTime: '20:00' }]
    const out = dropTimesOutsideWindow(drafts, window, draft => draft.startTime === '20:00')
    expect(out[0]?.startTime).toBe('20:00')
  })

  it('꼭 갈 곳의 예약 시간이 시간대 밖이면 예약 시간만 버림', () => {
    const musts = [
      { name: '성심당', reservedAt: '00:00' },
      { name: '한밭수목원', reservedAt: '14:00' },
      { name: '국립중앙과학관' },
    ]
    expect(mustVisitWithinWindow(musts, window)).toEqual([
      { name: '성심당' },
      { name: '한밭수목원', reservedAt: '14:00' },
      { name: '국립중앙과학관' },
    ])
  })
})
