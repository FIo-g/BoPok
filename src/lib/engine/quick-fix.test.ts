import { describe, expect, it } from 'vitest'
import type { JudgeInput, Leg, LegRequest, PlaceDetail, Stop, Traveler } from '@/lib/contracts'
import { DiffItemSchema, JudgeResultSchema, QuickFixSchema, legKey } from '@/lib/contracts'
import { judge } from './judge'
import { quickFixes } from './quick-fix'
import { requiredLegs } from './required-legs'
import { hanbat, places, science } from './test-fixtures'

// 판정 테스트와 같은 기본 여행자. 나이 없음 → 0.85 m/s, 조건 기본 20/60/10/계단 피하기.
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

function makeLeg(request: LegRequest, distanceM: number): Leg {
  return {
    key: legKey(request),
    mode: request.mode,
    distanceM,
    path: [request.from.coord, request.to.coord],
    stairsStatus: 'confirmed_none',
    source: '테스트 픽스처',
    checkedAt: '2026-10',
    confidence: 'C',
  }
}

// 같은 거리의 가짜 걷기 경로를 경로 순서대로 만든다. 외부 API는 부르지 않는다.
function walkLegs(stops: Stop[], distanceM: number): Record<string, Leg> {
  const legs: Record<string, Leg> = {}
  for (const request of requiredLegs(stops, places)) {
    legs[legKey(request)] = makeLeg(request, distanceM)
  }
  return legs
}

// Task 2B 첫 입력(노션 4-2). A로도 부족하고 B에서 쉼터를 넣으면 충족된다.
function notional42(): JudgeInput {
  return {
    travelers: [mom],
    tuned: { continuousMin: 23 },
    stops: [makeStop('k1', 'hanbat')],
    places,
    legs: {},
  }
}

// 조건을 넘은 시간의 합. C는 이 값이 줄어드는 곳만 택시로 바꾼다.
function overSum(input: { longest: { high: number }; day: { high: number }; condition: { continuousMin: number; dayMin: number } }): number {
  return (
    Math.max(0, input.longest.high - input.condition.continuousMin) +
    Math.max(0, input.day.high - input.condition.dayMin)
  )
}

// s1(주차장→입구, 출발 지점 구간)에 계단+우회로를 둔 한밭 복사. 우회로 대상이 아니다.
function hanbatAccessStairs(): Record<string, PlaceDetail> {
  const copy: PlaceDetail = structuredClone(hanbat)
  const s1 = copy.segments.find(segment => segment.id === 's1')
  if (!s1) throw new Error('s1이 있어야 해요')
  s1.stairsStatus = 'present'
  s1.stairsCount = 10
  copy.segments.push({ ...structuredClone(s1), id: 's1d', detourOf: 's1', distanceM: 500 })
  return { ...places, [copy.id]: copy }
}

// s4(관람 구간)를 선택+계단+우회로로 둔 한밭 복사. 빼기 대상이라 우회로를 쓰지 않는다.
function hanbatOptionalStairs(): Record<string, PlaceDetail> {
  const copy: PlaceDetail = structuredClone(hanbat)
  const s4 = copy.segments.find(segment => segment.id === 's4')
  if (!s4) throw new Error('s4가 있어야 해요')
  s4.optional = true
  s4.stairsStatus = 'present'
  s4.stairsCount = 5
  copy.segments.push({ ...structuredClone(s4), id: 's4d', detourOf: 's4', distanceM: 900 })
  return { ...places, [copy.id]: copy }
}

// 출구 노드가 없는 장소. 마지막 선택 구간을 빼면 장소 사이 경로 키가 바뀐다.
function noExitPlaces(): Record<string, PlaceDetail> {
  const noexit: PlaceDetail = {
    id: 'noexit',
    name: '출구 없는 곳',
    category: '공원',
    styles: [],
    coord: [127.38, 36.35],
    visitMin: 30,
    seated: false,
    indoor: false,
    source: '테스트 픽스처',
    checkedAt: '2026-10',
    confidence: 'C',
    nodes: [
      { id: 'NP', placeId: 'noexit', kind: 'parking', name: '주차장', restType: null, coord: [127.38, 36.35] },
      { id: 'NE', placeId: 'noexit', kind: 'entrance', name: '입구', restType: null, coord: [127.3805, 36.3505] },
      { id: 'NA', placeId: 'noexit', kind: 'sight', name: '볼거리', restType: null, coord: [127.381, 36.351] },
      { id: 'NB', placeId: 'noexit', kind: 'sight', name: '먼 볼거리', restType: null, coord: [127.382, 36.352] },
    ],
    segments: [
      { id: 'n0', placeId: 'noexit', fromNodeId: 'NP', toNodeId: 'NE', order: 0, distanceM: 200, path: [[127.38, 36.35], [127.3805, 36.3505]], stairsStatus: 'confirmed_none', slope: false, optional: false, source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
      { id: 'n1', placeId: 'noexit', fromNodeId: 'NE', toNodeId: 'NA', order: 1, distanceM: 100, path: [[127.3805, 36.3505], [127.381, 36.351]], stairsStatus: 'present', stairsCount: 8, slope: false, optional: false, source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
      { id: 'n1d', placeId: 'noexit', fromNodeId: 'NE', toNodeId: 'NA', order: 1, distanceM: 150, path: [[127.3805, 36.3505], [127.381, 36.351]], stairsStatus: 'confirmed_none', slope: false, optional: false, detourOf: 'n1', source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
      { id: 'n2', placeId: 'noexit', fromNodeId: 'NA', toNodeId: 'NB', order: 2, distanceM: 100, path: [[127.381, 36.351], [127.382, 36.352]], stairsStatus: 'confirmed_none', slope: false, optional: true, source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
    ],
  }
  return { ...places, [noexit.id]: noexit }
}

// 쉼터 둘이 같은 효과를 내는 장소. 걸어서 들어가면 쉼터 앞에서 끊어 동률이 된다.
function twoRestPlaces(): Record<string, PlaceDetail> {
  const flat: PlaceDetail = {
    id: 'flat',
    name: '평평한 곳',
    category: '공원',
    styles: [],
    coord: [127.38, 36.35],
    visitMin: 30,
    seated: false,
    indoor: false,
    source: '테스트 픽스처',
    checkedAt: '2026-10',
    confidence: 'C',
    nodes: [
      { id: 'FE', placeId: 'flat', kind: 'entrance', name: '입구', restType: null, coord: [127.38, 36.35] },
      { id: 'FR1', placeId: 'flat', kind: 'rest', name: '첫 쉼터', restType: 'outdoor', coord: [127.3805, 36.3505] },
      { id: 'FR2', placeId: 'flat', kind: 'rest', name: '둘째 쉼터', restType: 'outdoor', coord: [127.381, 36.351] },
      { id: 'FX', placeId: 'flat', kind: 'exit', name: '출구', restType: null, coord: [127.3815, 36.3515] },
    ],
    segments: [
      { id: 'f1', placeId: 'flat', fromNodeId: 'FE', toNodeId: 'FR1', order: 1, distanceM: 100, path: [[127.38, 36.35], [127.3805, 36.3505]], stairsStatus: 'confirmed_none', slope: false, optional: false, source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
      { id: 'f2', placeId: 'flat', fromNodeId: 'FR1', toNodeId: 'FR2', order: 2, distanceM: 100, path: [[127.3805, 36.3505], [127.381, 36.351]], stairsStatus: 'confirmed_none', slope: false, optional: false, source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
      { id: 'f3', placeId: 'flat', fromNodeId: 'FR2', toNodeId: 'FX', order: 3, distanceM: 100, path: [[127.381, 36.351], [127.3815, 36.3515]], stairsStatus: 'confirmed_none', slope: false, optional: false, source: '테스트 픽스처', checkedAt: '2026-10', confidence: 'C' },
    ],
  }
  return { ...places, [flat.id]: flat }
}

describe('quickFixes', () => {
  it('노션 4-2: A 부족 → B 해결', () => {
    const fixes = quickFixes(notional42())

    expect(fixes).toHaveLength(2)
    expect(fixes.map(fix => fix.level)).toEqual(['A', 'B'])

    const [a, b] = fixes
    expect(a.enough).toBe(false)
    expect(a.changes).toEqual([
      { kind: 'detour', stopKey: 'k1', segmentId: 's3', detourSegmentId: 's3d' },
      { kind: 'skip', stopKey: 'k1', segmentId: 's5' },
    ])
    expect(a.result.longest.base).toBeCloseTo(30, 6)
    expect(a.stops[0].detourMap).toEqual({ s3: 's3d' })
    expect(a.stops[0].skipSegmentIds).toEqual(['s5'])

    expect(b.enough).toBe(true)
    expect(b.changes).toEqual([
      ...a.changes,
      { kind: 'rest', stopKey: 'k1', nodeId: 'R' },
    ])
    expect(b.result.longest.base).toBeCloseTo(19, 6)
    expect(b.stops[0].restNodeIds).toEqual(['R'])
    expect(b.result.violations).toEqual([])
  })

  it('이미 충족이면 수정안 없음', () => {
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops: [makeStop('k1', 'science')],
      places,
      legs: {},
    }
    expect(judge(input).verdict).toBe('ok')
    expect(quickFixes(input)).toEqual([])
  })

  it('원래 정보 부족이면 수정안 없음', () => {
    const input: JudgeInput = {
      travelers: [mom],
      stops: [{ ...makeStop('k1', null), name: '점심', seated: true, coord: [127.38, 36.35] }],
      places,
      legs: {},
    }
    expect(judge(input).verdict).toBe('info')
    expect(quickFixes(input)).toEqual([])
  })

  it('A만으로 충족하면 A만', () => {
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops: [makeStop('k1', 'hanbat')],
      places,
      legs: {},
    }
    expect(judge(input).verdict).toBe('adjust')
    const fixes = quickFixes(input)
    expect(fixes.map(fix => fix.level)).toEqual(['A'])
    expect(fixes[0].enough).toBe(true)
  })

  it('계단 피하기가 아니면 우회로를 쓰지 않음', () => {
    const fixes = quickFixes({ ...notional42(), travelers: [stairsOk] })

    expect(fixes.length).toBeGreaterThan(0)
    const changes = fixes.flatMap(fix => fix.changes)
    expect(changes.some(change => change.kind === 'detour')).toBe(false)
    expect(fixes[0].stops[0].detourMap).toEqual({})
  })

  it('placeId가 원형 속성 이름이어도 예외 없이 판정', () => {
    const input = notional42()
    const evil: Stop[] = [
      { ...makeStop('k1', 'hanbat') },
      { ...makeStop('constructor', 'constructor'), name: '낯선 곳', arriveBy: 'walk', coord: [127.38, 36.35] },
      { ...makeStop('k3', 'toString'), name: '또 낯선 곳', arriveBy: 'walk', coord: [127.39, 36.36] },
    ]
    const withEvil: JudgeInput = { ...input, stops: evil }
    let fixes: ReturnType<typeof quickFixes> | undefined
    expect(() => {
      fixes = quickFixes(withEvil)
    }).not.toThrow()
    expect(Array.isArray(fixes)).toBe(true)
  })

  it('출발 지점 구간에는 우회로를 쓰지 않음', () => {
    const placesAccess = hanbatAccessStairs()
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops: [{ ...makeStop('k1', 'hanbat'), name: '한밭수목원' }],
      places: placesAccess,
      legs: {},
    }
    const fixes = quickFixes(input)
    expect(fixes.length).toBeGreaterThan(0)
    const detours = fixes[0].changes.filter(change => change.kind === 'detour')
    // s1(주차장→입구)은 관람 구간이 아니라 우회로 후보에서 빠진다.
    expect(detours.filter(change => change.segmentId === 's1')).toEqual([])
  })

  it('빼기 대상(optional)에는 우회로를 쓰지 않고 빼기만', () => {
    const placesOptional = hanbatOptionalStairs()
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops: [{ ...makeStop('k1', 'hanbat'), name: '한밭수목원' }],
      places: placesOptional,
      legs: {},
    }
    const fixes = quickFixes(input)
    expect(fixes.length).toBeGreaterThan(0)
    const detours = fixes[0].changes.filter(change => change.kind === 'detour')
    expect(detours.filter(change => change.segmentId === 's4')).toEqual([])
    expect(fixes[0].changes).toContainEqual({ kind: 'skip', stopKey: 'k1', segmentId: 's4' })
  })

  it('쉼터가 없으면 B는 건너뛰고 C', () => {
    const stops = [makeStop('k1', 'science'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 5 },
      stops,
      places,
      legs: walkLegs(stops, 100),
    }

    const fixes = quickFixes(input)

    expect(fixes.map(fix => fix.level)).toEqual(['C'])
  })

  it('C는 걷는 장소 사이를 택시로', () => {
    const stops = [makeStop('k1', 'science'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 5 },
      stops,
      places,
      legs: walkLegs(stops, 100),
    }

    const c = quickFixes(input).find(fix => fix.level === 'C')

    expect(c).toBeDefined()
    if (c === undefined) throw new Error('C 수정안이 있어야 해요')
    expect(c.stops[1].arriveBy).toBe('taxi')
    expect(c.changes).toEqual([{ kind: 'taxi', toStopKey: 'k2' }])
  })

  it('C는 넘은 합이 줄어드는 곳만 바꾸고, 아니면 내지 않음', () => {
    const stops = [
      { ...makeStop('k1', 'science'), name: science.name },
      { ...makeStop('k2', 'science', { arriveBy: 'walk' }), name: science.name },
    ]
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 20, dayMin: 30 },
      stops,
      places,
      legs: walkLegs(stops, 30),
    }
    const fixes = quickFixes(input)
    const before = fixes.find(fix => fix.level === 'B')?.result ?? judge(input)
    const c = fixes.find(fix => fix.level === 'C')
    if (c === undefined) {
      // 줄어드는 곳이 없으면 C를 내지 않는다.
      expect(fixes.map(fix => fix.level)).not.toContain('C')
    } else {
      expect(overSum(c.result)).toBeLessThan(overSum(before))
    }
  })

  it('원래 없던 빠진 경로가 생기면 enough가 아님', () => {
    const placesNoExit = noExitPlaces()
    const stops: Stop[] = [
      { key: 'k1', placeId: 'noexit', name: '출구 없는 곳', mustVisit: false, arriveBy: 'car', skipSegmentIds: [], detourMap: {}, restNodeIds: [] },
      { key: 'k2', placeId: 'science', name: '국립중앙과학관', mustVisit: false, arriveBy: 'walk', skipSegmentIds: [], detourMap: {}, restNodeIds: [] },
    ]
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops,
      places: placesNoExit,
      legs: {},
    }
    const baseMissing = judge(input).missingLegs
    expect(baseMissing).toHaveLength(1)
    const fixes = quickFixes(input)
    expect(fixes.length).toBeGreaterThan(0)
    // 마지막 선택 구간을 빼면 leg 키가 바뀌어 원래 없던 빠진 경로가 생긴다.
    expect(fixes[0].result.missingLegs).not.toEqual(baseMissing)
    expect(fixes[0].enough).toBe(false)
  })

  it('입력 stops를 바꾸지 않음', () => {
    const input = notional42()
    const snapshot: JudgeInput = structuredClone(input)
    quickFixes(input)
    expect(input).toEqual(snapshot)
  })

  it('같은 장소를 두 번 가도 stopKey마다 올바르게 변경', () => {
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 60, dayMin: 60 },
      stops: [makeStop('k1', 'hanbat'), makeStop('k2', 'hanbat')],
      places,
      legs: {},
    }
    const fixes = quickFixes(input)
    expect(fixes.length).toBeGreaterThan(0)
    const detours = fixes[0].changes.filter(change => change.kind === 'detour')
    expect(detours).toContainEqual({ kind: 'detour', stopKey: 'k1', segmentId: 's3', detourSegmentId: 's3d' })
    expect(detours).toContainEqual({ kind: 'detour', stopKey: 'k2', segmentId: 's3', detourSegmentId: 's3d' })
    expect(fixes[0].stops[0].detourMap).toEqual({ s3: 's3d' })
    expect(fixes[0].stops[1].detourMap).toEqual({ s3: 's3d' })
  })

  it('쉼터 효과가 같으면 경로에서 먼저 나온 곳', () => {
    const flatPlaces = twoRestPlaces()
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 2 },
      stops: [{ key: 'k1', placeId: 'flat', name: '평평한 곳', mustVisit: false, arriveBy: 'walk', skipSegmentIds: [], detourMap: {}, restNodeIds: [] }],
      places: flatPlaces,
      legs: {},
    }
    const fixes = quickFixes(input)
    const b = fixes.find(fix => fix.level === 'B')
    expect(b).toBeDefined()
    if (b === undefined) throw new Error('B 수정안이 있어야 해요')
    const rests = b.changes.filter(change => change.kind === 'rest')
    expect(rests.length).toBeGreaterThan(0)
    expect(rests[0]).toEqual({ kind: 'rest', stopKey: 'k1', nodeId: 'FR1' })
  })

  it('이미 쉬기로 한 쉼터는 후보가 아님', () => {
    const input: JudgeInput = {
      ...notional42(),
      stops: [{ ...makeStop('k1', 'hanbat'), restNodeIds: ['R'] }],
    }
    const fixes = quickFixes(input)
    for (const fix of fixes) {
      expect(fix.changes.filter(change => change.kind === 'rest')).toEqual([])
    }
  })

  it('위반 묶음이 둘이면 쉼터를 차례로 각 묶음에', () => {
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 23 },
      stops: [makeStop('k1', 'hanbat'), makeStop('k2', 'hanbat')],
      places,
      legs: {},
    }
    const fixes = quickFixes(input)
    const b = fixes.find(fix => fix.level === 'B')
    expect(b).toBeDefined()
    if (b === undefined) throw new Error('B 수정안이 있어야 해요')
    const rests = b.changes.filter(change => change.kind === 'rest')
    expect(rests.length).toBeGreaterThanOrEqual(2)
    expect(rests[0]).toEqual({ kind: 'rest', stopKey: 'k1', nodeId: 'R' })
    expect(rests[1]).toEqual({ kind: 'rest', stopKey: 'k2', nodeId: 'R' })
  })

  it('결과는 QuickFixSchema 통과', () => {
    for (const fix of quickFixes(notional42())) {
      expect(() => QuickFixSchema.parse(fix)).not.toThrow()
      expect(() => JudgeResultSchema.parse(fix.result)).not.toThrow()
      for (const stop of fix.stops) expect(stop.key).toBe('k1')
    }
  })

  it('taxi 변경도 QuickFixSchema 통과', () => {
    const stops = [makeStop('k1', 'science'), makeStop('k2', 'science', { arriveBy: 'walk' })]
    const input: JudgeInput = {
      travelers: [mom],
      tuned: { continuousMin: 5 },
      stops,
      places,
      legs: walkLegs(stops, 100),
    }
    const c = quickFixes(input).find(fix => fix.level === 'C')
    expect(c).toBeDefined()
    if (c === undefined) throw new Error('C 수정안이 있어야 해요')
    expect(() => QuickFixSchema.parse(c)).not.toThrow()
  })

  it('DiffItemSchema는 바뀐 항목을 통과', () => {
    expect(DiffItemSchema.parse({ kind: 'stairs', before: 2, after: 0 })).toBeTruthy()
    expect(() => DiffItemSchema.parse({ kind: 'stairs', before: -1, after: 0 })).toThrow()
  })
})
