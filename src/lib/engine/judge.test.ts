import { describe, expect, it } from 'vitest'
import type {
  JudgeInput,
  Leg,
  LegRequest,
  PlaceDetail,
  PlaceSegment,
  Stop,
  Traveler,
} from '@/lib/contracts'
import { JudgeResultSchema, legKey } from '@/lib/contracts'
import { judge } from './judge'
import { requiredLegs } from './required-legs'
import { places as fixtures } from './test-fixtures'

// Task 2A 픽스처에는 museum이 없다(2A에서는 '상세가 아직 없는 장소'로 쓰기 때문).
// 2B 테스트에만 필요한 museum 상세를 여기서 따로 만든다 — 다른 작업자 파일은 고치지 않는다.
const MUSEUM = 'museum'
const mP: [number, number] = [127.38, 36.36]
const mE: [number, number] = [127.381, 36.361]
const mA: [number, number] = [127.382, 36.362]
const mX: [number, number] = [127.383, 36.363]

function museumSegment(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  order: number,
  distanceM: number,
  fromCoord: [number, number],
  toCoord: [number, number],
): PlaceSegment {
  return {
    id,
    placeId: MUSEUM,
    fromNodeId,
    toNodeId,
    order,
    distanceM,
    path: [fromCoord, toCoord],
    stairsStatus: 'confirmed_none',
    slope: false,
    optional: false,
    source: '테스트 픽스처',
    checkedAt: '2026-10',
    confidence: 'C',
  }
}

const museum: PlaceDetail = {
  id: MUSEUM,
  name: '대전시립미술관',
  category: '미술관',
  styles: ['예술·전시'],
  coord: mA,
  visitMin: 60,
  seated: false,
  indoor: true,
  source: '테스트 픽스처',
  checkedAt: '2026-10',
  confidence: 'C',
  nodes: [
    { id: 'P3', placeId: MUSEUM, kind: 'parking', name: '주차장', restType: null, coord: mP },
    { id: 'E3', placeId: MUSEUM, kind: 'entrance', name: '입구', restType: null, coord: mE },
    { id: 'A3', placeId: MUSEUM, kind: 'sight', name: '전시실', restType: null, coord: mA },
    { id: 'X3', placeId: MUSEUM, kind: 'exit', name: '출구', restType: null, coord: mX },
  ],
  segments: [
    museumSegment('m1', 'P3', 'E3', 0, 150, mP, mE),
    museumSegment('m2', 'E3', 'A3', 1, 200, mE, mA),
    museumSegment('m3', 'A3', 'X3', 2, 100, mA, mX),
  ],
}

const places: Record<string, PlaceDetail> = {
  ...fixtures,
  [MUSEUM]: museum,
}

// 계단 상태만 바꾼 한밭수목원. 기대 숫자는 test-fixtures의 거리 그대로다.
function withHanbatStairs(stairsStatus: PlaceSegment['stairsStatus']): PlaceDetail {
  return {
    ...fixtures.hanbat,
    segments: fixtures.hanbat.segments.map(segment =>
      segment.id === 's3'
        ? { ...segment, stairsStatus, stairsCount: stairsStatus === 'present' ? 24 : undefined }
        : segment,
    ),
  }
}

function placesWithHanbatStairs(stairsStatus: PlaceSegment['stairsStatus']): Record<string, PlaceDetail> {
  return { ...places, hanbat: withHanbatStairs(stairsStatus) }
}

const mom: Traveler = {
  id: 't1',
  label: '엄마',
  isParent: true,
  pace: 'normal',
  mobilityAid: false,
  condition: {},
  filledBySelf: true,
}

// '계단 괜찮음' (조건 avoidStairs:false)
const stairsOk: Traveler = { ...mom, condition: { avoidStairs: false } }

function makeStop(key: string, placeId: string | null, over: Partial<Stop> = {}): Stop {
  const place = placeId ? places[placeId] : undefined
  return {
    key,
    placeId,
    name: place?.name ?? '점심',
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...over,
  }
}

function makeLeg(request: LegRequest, distanceM: number, over: Partial<Leg> = {}): Leg {
  return {
    key: legKey(request),
    mode: request.mode,
    distanceM,
    path: [request.from.coord, request.to.coord],
    stairsStatus: 'confirmed_none',
    source: '테스트 픽스처',
    checkedAt: '2026-10',
    confidence: 'C',
    ...over,
  }
}

// 같은 거리의 가짜 걷기 경로를 경로 순서대로 만든다. 외부 API는 부르지 않는다.
function walkLegs(stops: Stop[], distanceM: number, stairsStatus: Leg['stairsStatus'] = 'confirmed_none'): Record<string, Leg> {
  const legs: Record<string, Leg> = {}
  for (const request of requiredLegs(stops, places)) {
    legs[legKey(request)] = makeLeg(request, distanceM, { stairsStatus })
  }
  return legs
}

const lunch = (key = 'k2'): Stop =>
  makeStop(key, null, { name: '점심', arriveBy: 'walk', seated: true, coord: [127.39, 36.36] })

describe('judge', () => {
  it('노션 4-2 예시: 원래 일정', () => {
    // 노션 예시는 한 값(28·30·19분)으로 적었고 우리는 범위 최댓값(×1.2)으로 비교하므로,
    // "A 부족 → B 해결"이 같게 나오도록 조건을 23분으로 둔다.
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 23 },
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    }

    const result = judge(input)

    expect(result.verdict).toBe('adjust')
    expect(result.reason).toBe('한밭수목원 안에 계단 구간이 있어요')
    expect(result.longest.base).toBeCloseTo(28, 6)
    expect(result.longest.fromStopKey).toBe('k1')
    expect(result.longest.toStopKey).toBe('k1')
    expect(result.violations).toHaveLength(2)
    expect(result.violations[0]).toEqual({ kind: 'stairs', stopKey: 'k1', segmentId: 's3', count: 24 })
    const continuous = result.violations[1]
    expect(continuous.kind).toBe('continuous')
    if (continuous.kind !== 'continuous') throw new Error('연속 걷기 위반이어야 해요')
    expect(continuous.fromStopKey).toBe('k1')
    expect(continuous.toStopKey).toBe('k1')
    expect(continuous.over).toBeCloseTo(33.6 - 23, 9)
  })

  it('걸어서 이어지면 묶음도 이어짐', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const input: JudgeInput = { travelers: [stairsOk], stops, places, legs: walkLegs(stops, 120) }

    const result = judge(input)

    expect(result.longest.base).toBeCloseTo(38.196, 3)
    expect(result.longest.fromStopKey).toBe('k1')
    expect(result.longest.toStopKey).toBe('k2')
    expect(result.reason).toBe(
      '한밭수목원에서 국립중앙과학관까지 쉬지 않고 약 38~46분을 걸어야 해요 (조건 20분)',
    )
  })

  it('탈것이면 끊김', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science')]
    const result = judge({ travelers: [mom], stops, places, legs: {} })

    expect(result.longest.base).toBeCloseTo(33, 6)
    expect(result.longest.fromStopKey).toBe('k1')
    expect(result.longest.toStopKey).toBe('k1')
  })

  it('앉는 장소에서 끊김', () => {
    const stops = [makeStop('k1', 'science'), lunch(), makeStop('k3', 'museum', { arriveBy: 'walk' })]
    const legs = walkLegs(stops, 100)
    const result = judge({ travelers: [mom], stops, places, legs })

    expect(result.legs.filter(leg => leg.mode === 'walk')).toHaveLength(2)
    expect(result.unknownStopKeys).toEqual(['k2'])
    // 앉는 곳(k2)에서 끊기므로 가장 긴 묶음은 science 묶음(장소 600 m + 걷기 100 m)이고,
    // 하루 전체(두 묶음 + 걷기 두 번)보다 짧다.
    expect(result.longest.fromStopKey).toBe('k1')
    expect(result.longest.toStopKey).toBe('k2')
    expect(result.longest.base).toBeCloseTo((600 + 100) / 51, 3)
    expect(result.longest.base).toBeLessThan(result.day.base)
  })

  it('쉼터에서 쉬면 끊기고 쉬는 시간 더함', () => {
    const stops = [makeStop('k1', 'hanbat', { restNodeIds: ['R'] })]
    const result = judge({ travelers: [mom], stops, places, legs: {} })

    expect(result.longest.base).toBeCloseTo(17, 6)
    expect(result.longest.fromStopKey).toBe('k1')
    expect(result.longest.toStopKey).toBe('k1')
    expect(result.restTotalMin).toBe(10)
  })

  it('계단 기록 없음은 위반 아님', () => {
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'hanbat')],
      places: placesWithHanbatStairs('unknown'),
      legs: {},
    })

    expect(result.violations.filter(violation => violation.kind === 'stairs')).toEqual([])
    expect(result.unrecordedStairs).toEqual([{ segmentId: 's3' }])
  })

  it('없음 확인도 위반 아님', () => {
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'hanbat')],
      places: placesWithHanbatStairs('confirmed_none'),
      legs: {},
    })

    expect(result.violations.filter(violation => violation.kind === 'stairs')).toEqual([])
    expect(result.unrecordedStairs).toEqual([])
  })

  it('계단 피하기가 아니면 계단은 위반 아님', () => {
    const result = judge({
      travelers: [stairsOk],
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    })

    expect(result.violations.filter(violation => violation.kind === 'stairs')).toEqual([])
  })

  it('부분 판정', () => {
    const stops = [makeStop('k1', 'science'), lunch()]
    const result = judge({ travelers: [mom], stops, places, legs: walkLegs(stops, 100) })

    expect(result.verdict).toBe('info')
    expect(result.reason).toBe('장소 사이 이동은 조건에 맞아요. 점심 안의 길은 아직 정보가 없어요')
  })

  it('빠진 경로는 지어내지 않음', () => {
    const stops = [makeStop('k1', 'science'), makeStop('k2', 'museum', { arriveBy: 'walk' })]
    const result = judge({ travelers: [mom], tuned: { continuousMin: 30 }, stops, places, legs: {} })

    expect(result.missingLegs).toHaveLength(1)
    expect(typeof result.missingLegs[0].legKey).toBe('string')
    // science(차: 600 m) + museum(걷기: 300 m) = 900 m ÷ 51 m/분
    expect(result.day.base).toBeCloseTo(17.647, 3)
    expect(result.verdict).toBe('info')
    expect(result.reason).toBe('국립중앙과학관에서 대전시립미술관 가는 길 정보를 아직 받지 못했어요')
  })

  it('빠진 경로가 있어도 알려진 걷기만으로 넘으면 조정 필요', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const result = judge({ travelers: [stairsOk], stops, places, legs: {} })

    expect(result.verdict).toBe('adjust')
    expect(result.missingLegs).toHaveLength(1)
    expect(result.violations.some(violation => violation.kind === 'continuous')).toBe(true)
  })

  it('상세가 아직 없는 장소는 정보 부족', () => {
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'nowhere', { name: '새로 생긴 곳', coord: [127.4, 36.4] })],
      places,
      legs: {},
    })

    expect(result.verdict).toBe('info')
    expect(result.unknownStopKeys).toEqual(['k1'])
    expect(result.reason).toBe('새로 생긴 곳 안의 길은 아직 정보가 없어요')
  })

  it('걷는 구간이 없으면 longest 키 null', () => {
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'nowhere', { name: '새로 생긴 곳', coord: [127.4, 36.4] })],
      places,
      legs: {},
    })

    expect(result.longest).toEqual({ base: 0, high: 0, fromStopKey: null, toStopKey: null })
  })

  it('하루 총 위반 문장', () => {
    const result = judge({
      travelers: [stairsOk],
      tuned: { continuousMin: 60, dayMin: 30 },
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    })

    expect(result.reason).toBe('하루 동안 모두 약 28~34분을 걸어야 해요 (조건 30분)')
    expect(result.violations).toHaveLength(1)
    const day = result.violations[0]
    expect(day.kind).toBe('day')
    if (day.kind !== 'day') throw new Error('하루 총 위반이어야 해요')
    expect(day.over).toBeCloseTo(3.6, 9)
  })

  it('같은 장소 두 번', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science'), makeStop('k3', 'hanbat')]
    const result = judge({ travelers: [mom], stops, places, legs: {} })

    expect(result.stops).toHaveLength(3)
    expect(result.stops.map(stop => stop.stopKey)).toEqual(['k1', 'k2', 'k3'])
    // k1은 돌아가는 s1까지 6줄(33분), 마지막 k3은 돌아가는 길 없이 5줄(28분). 배열도 따로다.
    expect(result.stops[0].segments.map(segment => segment.segmentId)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
      's1',
    ])
    expect(result.stops[2].segments.map(segment => segment.segmentId)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
    ])
    expect(result.stops[0].segments).not.toBe(result.stops[2].segments)
    expect(result.stops[0].walk.base).toBeCloseTo(33, 6)
    expect(result.stops[2].walk.base).toBeCloseTo(28, 6)
    // 돌아가는 줄은 거꾸로 걷는 줄이다.
    const returning = result.stops[0].segments.at(-1)
    expect(returning?.reverse).toBe(true)
    expect(returning?.label).toBe('입구 → 주차장')
  })

  it('같은 구간을 두 번 걸어도 계단 위반은 한 번', () => {
    const s1Present: PlaceDetail = {
      ...fixtures.hanbat,
      segments: fixtures.hanbat.segments.map(segment =>
        segment.id === 's1'
          ? { ...segment, stairsStatus: 'present' as const, stairsCount: 12 }
          : segment.id === 's3'
            ? { ...segment, stairsStatus: 'confirmed_none' as const, stairsCount: undefined }
            : segment,
      ),
    }
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'hanbat'), makeStop('k2', 'science')],
      places: { ...places, hanbat: s1Present },
      legs: {},
    })

    // s1 present가 들어갈 때·돌아갈 때 두 번 나오지만 위반은 (k1, s1) 한 번. 걷는 시간은 두 번 센다.
    expect(result.violations.filter(violation => violation.kind === 'stairs')).toEqual([
      { kind: 'stairs', stopKey: 'k1', segmentId: 's1', count: 12 },
    ])
  })

  it('같은 구간을 두 번 걸어도 기록 없음은 한 번', () => {
    const s1Unknown: PlaceDetail = {
      ...fixtures.hanbat,
      segments: fixtures.hanbat.segments.map(segment =>
        segment.id === 's1' ? { ...segment, stairsStatus: 'unknown' as const } : segment,
      ),
    }
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'hanbat'), makeStop('k2', 'science')],
      places: { ...places, hanbat: s1Unknown },
      legs: {},
    })

    // s1 unknown이 들어갈 때·돌아갈 때 두 번 나오지만 한 번만 모은다.
    expect(result.unrecordedStairs.filter(entry => entry.segmentId === 's1')).toHaveLength(1)
  })

  it('비어 있으면 정보 부족', () => {
    const result = judge({ travelers: [mom], stops: [], places, legs: {} })

    expect(result.verdict).toBe('info')
    expect(result.reason).toBe('일정에 장소가 아직 없어요')
  })

  it('충족인데 기록 없는 구간이 있으면 뒤에 붙음', () => {
    const stops = [makeStop('k1', 'science')]
    const unknownScience: PlaceDetail = {
      ...places.science,
      segments: places.science.segments.map(segment =>
        segment.id === 'c2' ? { ...segment, stairsStatus: 'unknown' as const } : segment,
      ),
    }
    const result = judge({
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops,
      places: { ...places, science: unknownScience },
      legs: {},
    })

    expect(result.verdict).toBe('ok')
    expect(result.reason).toBe(
      '모든 구간이 부모님 조건에 맞아요. 다만 계단 기록이 없는 구간이 1곳 있어요',
    )
  })

  it('걸어서 들어오는 입구 쉼터에서 묶음이 나뉨', () => {
    const stops = [
      makeStop('k1', 'science'),
      makeStop('k2', 'hanbat', { arriveBy: 'walk', restNodeIds: ['E'] }),
    ]
    const result = judge({ travelers: [stairsOk], stops, places, legs: walkLegs(stops, 100) })

    expect(result.restTotalMin).toBe(10)
    // 걷기 경로 뒤에서 묶음이 닫히므로 한밭 쪽(6+8+9=23분)이 가장 긴 묶음이다.
    expect(result.longest.fromStopKey).toBe('k2')
    expect(result.longest.toStopKey).toBe('k2')
    expect(result.longest.base).toBeCloseTo(23, 6)
  })

  it('placeId가 원형 이름이어도 멈추지 않음', () => {
    const result = judge({
      travelers: [mom],
      stops: [makeStop('k1', 'constructor', { name: '새로 생긴 곳', coord: [127.4, 36.4] })],
      places,
      legs: {},
    })

    expect(result.verdict).toBe('info')
    expect(result.unknownStopKeys).toEqual(['k1'])
  })

  it('좌표 없는 식당은 빠진 경로 legKey null', () => {
    const stops = [
      makeStop('k1', 'science'),
      makeStop('k2', null, { name: '점심', arriveBy: 'walk', seated: true }),
    ]
    const result = judge({ travelers: [mom], stops, places, legs: {} })

    expect(result.missingLegs).toHaveLength(1)
    expect(result.missingLegs[0].legKey).toBeNull()
    expect(result.verdict).toBe('info')
    // 판정된 걷기 경로가 없고 빠진 경로가 있으므로 "장소 사이 이동은 조건에 맞아요"가 아니다.
    expect(result.reason).toBe('점심 안의 길은 아직 정보가 없어요')
  })

  it('묶음이 조건을 넘으면 그 묶음만 warn', () => {
    const stops = [makeStop('k1', 'hanbat', { restNodeIds: ['R'] })]
    const result = judge({ travelers: [mom], stops, places, legs: {} })

    // s1+s2 묶음(11분, 최댓값 13.2분)은 조건 20분 안에, s3+s4+s5 묶음(17분, 최댓값 20.4분)은 넘는다.
    const first = result.stops[0].segments.filter(segment => ['s1', 's2'].includes(segment.segmentId))
    const second = result.stops[0].segments.filter(segment => ['s3', 's4', 's5'].includes(segment.segmentId))
    expect(first.every(segment => segment.status === 'ok')).toBe(true)
    expect(second.every(segment => segment.status === 'warn')).toBe(true)
  })

  it('걷기 경로 계단은 장소 사이 문장', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    // 장소 안 계단은 없애고 걷기 경로 계단만 남긴다.
    const result = judge({
      travelers: [mom],
      stops,
      places: placesWithHanbatStairs('confirmed_none'),
      legs: walkLegs(stops, 120, 'present'),
    })

    const stairs = result.violations.filter(violation => violation.kind === 'stairs')
    expect(stairs).toHaveLength(1)
    expect(stairs[0]).toEqual({
      kind: 'stairs',
      stopKey: null,
      legKey: result.legs.find(leg => leg.mode === 'walk')?.legKey,
      count: undefined,
    })
    expect(result.reason).toBe('한밭수목원에서 국립중앙과학관 가는 길에 계단이 있어요')
  })

  it('걷기 경로 계단 기록 없음은 legKey로 모음', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const legs = walkLegs(stops, 120, 'unknown')
    const result = judge({ travelers: [mom], stops, places, legs })

    expect(result.unrecordedStairs.filter(entry => entry.legKey !== undefined)).toHaveLength(1)
    expect(result.unrecordedStairs).toContainEqual({
      legKey: result.legs.find(leg => leg.mode === 'walk')?.legKey,
    })
  })

  it('연속 위반 한 장소 문장', () => {
    const result = judge({
      travelers: [stairsOk],
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    })

    expect(result.reason).toBe('한밭수목원 안에서 쉬지 않고 약 28~34분을 걸어야 해요 (조건 20분)')
  })

  it('하루 넘은 분이 더 크면 하루 문장', () => {
    const result = judge({
      travelers: [stairsOk],
      tuned: { continuousMin: 30, dayMin: 25 },
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    })

    expect(result.reason).toBe('하루 동안 모두 약 28~34분을 걸어야 해요 (조건 25분)')
  })

  it('넘은 분이 같으면 연속 문장', () => {
    const result = judge({
      travelers: [stairsOk],
      tuned: { continuousMin: 25, dayMin: 25 },
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    })

    expect(result.reason).toBe('한밭수목원 안에서 쉬지 않고 약 28~34분을 걸어야 해요 (조건 25분)')
  })

  it('탈것 경로 데이터가 있으면 rideMin', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science')]
    const requests = requiredLegs(stops, places)
    const key = legKey(requests[0])
    const legs: Record<string, Leg> = {
      [key]: {
        ...makeLeg(requests[0], 1000),
        mode: 'car',
        durationMin: 12,
      },
    }
    const result = judge({ travelers: [mom], stops, places, legs })

    expect(result.legs.find(leg => leg.legKey === key)?.rideMin).toBe(12)
  })

  it('stops known은 상세 유무로', () => {
    const stops = [
      makeStop('k1', 'hanbat'),
      makeStop('k2', 'nowhere', { name: '새로 생긴 곳', coord: [127.4, 36.4] }),
    ]
    const result = judge({ travelers: [mom], stops, places, legs: {} })

    expect(result.stops.map(stop => stop.known)).toEqual([true, false])
  })

  it('결과는 계약을 통과', () => {
    const routeTwo = [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const partial = [makeStop('k1', 'science'), lunch()]
    const inputs: JudgeInput[] = [
      { travelers: [mom], tuned: { continuousMin: 23 }, stops: [makeStop('k1', 'hanbat')], places, legs: {} },
      { travelers: [stairsOk], stops: routeTwo, places, legs: walkLegs(routeTwo, 120) },
      { travelers: [mom], stops: partial, places, legs: walkLegs(partial, 100) },
      {
        travelers: [mom],
        stops: [makeStop('k1', 'science'), makeStop('k2', 'museum', { arriveBy: 'walk' })],
        places,
        legs: {},
      },
      {
        travelers: [mom],
        stops: [makeStop('k1', 'nowhere', { name: '새로 생긴 곳', coord: [127.4, 36.4] })],
        places,
        legs: {},
      },
    ]

    for (const input of inputs) {
      expect(JudgeResultSchema.parse(judge(input))).toBeTruthy()
    }
  })

  it('같은 입력 같은 결과', () => {
    const stops = [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const input: JudgeInput = { travelers: [mom], stops, places, legs: walkLegs(stops, 120) }
    const before = structuredClone(input)

    expect(judge(input)).toEqual(judge(input))
    // 판정이 입력을 바꾸지 않는다.
    expect(input).toEqual(before)
  })

  it('일행 조건이 결과에', () => {
    const child: Traveler = {
      id: 't2',
      label: '자녀',
      isParent: false,
      pace: 'normal',
      mobilityAid: false,
      condition: { continuousMin: 10 },
      filledBySelf: true,
    }
    const result = judge({
      travelers: [{ ...mom, condition: { continuousMin: 30 } }, child],
      stops: [makeStop('k1', 'nowhere', { name: '새로 생긴 곳', coord: [127.4, 36.4] })],
      places,
      legs: {},
    })

    expect(result.condition.continuousMin).toBe(26)
    expect(result.conditionFrom.continuousMin).toBe('blend')
    expect(result.speedTravelerId).toBe('t1')
  })
})
