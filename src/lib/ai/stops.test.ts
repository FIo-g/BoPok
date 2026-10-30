// AI가 고른 자리 → Stop[] 바꾸기 검사. 순수 함수라 외부 호출이 없다.
import { describe, expect, it } from 'vitest'
import { StopSchema, type Coord, type PlaceSummary } from '@/lib/contracts'
import { arriveByFor, draftsToStops, enforceMustStops, restoreMustStops, samePlaceName } from './stops'
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
