import { describe, expect, it } from 'vitest'
import type { DiffItem, JudgeInput, JudgeResult, Stop, Traveler } from '@/lib/contracts'
import { DiffItemSchema } from '@/lib/contracts'
import { judge } from './judge'
import { diffStops, diffSummary, fixedChangeSentence, formatDiffItem, formatStopDiff } from './diff'
import { quickFixes } from './quick-fix'
import { places } from './test-fixtures'

const mom: Traveler = {
  id: 't1',
  label: '엄마',
  isParent: true,
  pace: 'normal',
  mobilityAid: false,
  condition: {},
  filledBySelf: true,
}

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

function notional42(): JudgeInput {
  return {
    travelers: [mom],
    tuned: { continuousMin: 23 },
    stops: [makeStop('k1', 'hanbat')],
    places,
    legs: {},
  }
}

describe('diffSummary', () => {
  it('diff: 바뀐 것만, 순서', () => {
    const input = notional42()
    const before = judge(input)
    const fixes = quickFixes(input)
    const after = fixes.find(fix => fix.level === 'B')?.result
    if (after === undefined) throw new Error('B 수정안이 있어야 해요')

    const items = diffSummary(before, after)

    // 바뀐 항목만: 판정 · 계단 수 · 가장 긴 연속 걷기 · 하루 총 걷기 · 쉬는 시간 순서
    expect(items.map(item => item.kind)).toEqual(['verdict', 'stairs', 'longest', 'day', 'restTotal'])
    expect(items[0]).toEqual({ kind: 'verdict', before: 'adjust', after: 'ok' })
    expect(items[1]).toEqual({ kind: 'stairs', before: 1, after: 0 })
  })

  it('바뀐 것이 없으면 빈 배열', () => {
    const before = judge(notional42())

    expect(diffSummary(before, before)).toEqual([])
  })

  it('같은 항목은 빠짐 (일부만 바뀜)', () => {
    const before = judge(notional42())
    // 판정만 바꾼 쌍: 판정 외 항목은 모두 같아 빠진다.
    const after: JudgeResult = { ...before, verdict: 'ok' }
    expect(diffSummary(before, after)).toEqual([{ kind: 'verdict', before: before.verdict, after: 'ok' }])
  })

  it('반올림으로 같게 보이면 빠짐', () => {
    const judged = judge(notional42())
    // 반올림 경계에서 먼 값(28분)으로 고정한다 — 계단 시간 근거가 바뀌어도 이 검사가 경계에 걸리지 않게.
    const before: JudgeResult = {
      ...judged,
      longest: { ...judged.longest, base: 28, high: 33.6 },
      day: { ...judged.day, base: 28, high: 33.6 },
    }
    // formatRange가 같으면(분 단위 표시가 같으면) longest·day는 빠진다.
    const after: JudgeResult = {
      ...before,
      longest: { ...before.longest, base: before.longest.base + 0.1 },
      day: { ...before.day, base: before.day.base + 0.1 },
    }
    const kinds = diffSummary(before, after).map(item => item.kind)
    expect(kinds).not.toContain('longest')
    expect(kinds).not.toContain('day')
  })

  it('DiffItemSchema 다섯 종류 모두 통과', () => {
    const items: DiffItem[] = [
      { kind: 'verdict', before: 'adjust', after: 'ok' },
      { kind: 'stairs', before: 1, after: 0 },
      { kind: 'longest', before: { base: 27, high: 32 }, after: { base: 18, high: 22 } },
      { kind: 'day', before: { base: 40, high: 48 }, after: { base: 30, high: 36 } },
      { kind: 'restTotal', before: 0, after: 10 },
    ]
    for (const item of items) {
      expect(() => DiffItemSchema.parse(item)).not.toThrow()
    }
  })

  it('formatDiffItem 문장', () => {
    const items: DiffItem[] = [
      { kind: 'verdict', before: 'adjust', after: 'ok' },
      { kind: 'stairs', before: 2, after: 0 },
      { kind: 'longest', before: { base: 27, high: 32 }, after: { base: 18, high: 22 } },
      { kind: 'day', before: { base: 40, high: 48 }, after: { base: 30, high: 36 } },
      { kind: 'restTotal', before: 0, after: 10 },
    ]

    expect(items.map(formatDiffItem)).toEqual([
      '판정 조정 필요 → 조건 충족',
      '계단 구간 2곳 → 0곳',
      '가장 긴 연속 걷기 약 27~32분 → 약 18~22분',
      '하루 총 걷기 약 40~48분 → 약 30~36분',
      '쉬는 시간 0분 → 10분',
    ])
    expect(formatDiffItem({ kind: 'verdict', before: 'ok', after: 'info' })).toBe('판정 조건 충족 → 정보 부족')
  })
})

describe('fixedChangeSentence', () => {
  it('fixedChangeSentence', () => {
    expect(fixedChangeSentence([])).toBe('바뀐 점 없음')
    expect(
      fixedChangeSentence([
        { kind: 'detour', stopKey: 'k1', segmentId: 's3', detourSegmentId: 's3d' },
        { kind: 'skip', stopKey: 'k1', segmentId: 's5' },
        { kind: 'rest', stopKey: 'k1', nodeId: 'R' },
        { kind: 'taxi', toStopKey: 'k2' },
      ]),
    ).toBe('계단 구간 1곳을 우회로로 변경, 선택 구간 1곳 빼기, 쉼터 1곳에서 쉬기, 장소 사이 1곳을 택시로')

    expect(
      fixedChangeSentence([
        { kind: 'skip', stopKey: 'k1', segmentId: 's5' },
        { kind: 'skip', stopKey: 'k1', segmentId: 's6' },
      ]),
    ).toBe('선택 구간 2곳 빼기')
  })
})

// 일정 칸(Stop) 비교: 같은 장소는 placeId, 식사 자리처럼 placeId 가 없으면 이름으로 짝짓는다.
function plainStop(name: string, placeId: string | null, startTime?: string): Stop {
  return {
    key: `k-${name}`,
    placeId,
    name,
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...(startTime !== undefined ? { startTime } : {}),
  }
}

describe('diffStops', () => {
  it('새로 넣은 곳 · 뺀 곳 · 시작 시각이 바뀐 곳을 찾는다', () => {
    const prev = [
      plainStop('대전 한밭수목원', 'hanbat', '14:00'),
      plainStop('점심 식사', null, '12:30'),
      plainStop('이응노미술관', 'leeungno'),
    ]
    const next = [
      plainStop('점심 식사', null, '12:00'),
      plainStop('점심 후 휴식', null),
      plainStop('대전 한밭수목원', 'hanbat', '14:30'),
    ]

    // 새 안 순서대로 추가·시각 변경을 적고, 뺀 곳은 뒤에 붙인다
    expect(diffStops(prev, next)).toEqual([
      { kind: 'time', name: '점심 식사', before: '12:30', after: '12:00' },
      { kind: 'added', name: '점심 후 휴식' },
      { kind: 'time', name: '대전 한밭수목원', before: '14:00', after: '14:30' },
      { kind: 'removed', name: '이응노미술관' },
    ])
  })

  it('바뀐 것이 없으면 빈 배열', () => {
    const stops = [plainStop('대전 한밭수목원', 'hanbat', '14:00'), plainStop('점심 식사', null)]

    expect(diffStops(stops, stops)).toEqual([])
  })

  it('순서만 바뀌면 빈 배열', () => {
    const prev = [plainStop('대전 한밭수목원', 'hanbat', '14:00'), plainStop('이응노미술관', 'leeungno', '15:00')]
    const next = [plainStop('이응노미술관', 'leeungno', '15:00'), plainStop('대전 한밭수목원', 'hanbat', '14:00')]

    expect(diffStops(prev, next)).toEqual([])
  })

  it('placeId 가 null 인 식사 자리는 이름으로 짝지어 추가·삭제로 보지 않는다', () => {
    const prev = [plainStop('점심 식사', null, '12:30')]
    const next = [plainStop('점심 식사', null, '12:30')]

    expect(diffStops(prev, next)).toEqual([])
  })

  it('한쪽에만 시각이 있으면 시각 변경으로 보지 않는다', () => {
    const prev = [plainStop('대전 한밭수목원', 'hanbat')]
    const next = [plainStop('대전 한밭수목원', 'hanbat', '14:30')]

    expect(diffStops(prev, next)).toEqual([])
  })

  it('같은 장소가 같은 이름이어도 placeId 가 다르면 다른 곳이다', () => {
    const prev = [plainStop('카페', 'cafe-a')]
    const next = [plainStop('카페', 'cafe-b')]

    expect(diffStops(prev, next)).toEqual([
      { kind: 'added', name: '카페' },
      { kind: 'removed', name: '카페' },
    ])
  })
})

describe('formatStopDiff', () => {
  it('문장: 새로 넣은 곳 · 뺀 곳 · 시간 바뀜', () => {
    expect(
      formatStopDiff([
        { kind: 'added', name: '점심 후 휴식' },
        { kind: 'removed', name: '이응노미술관' },
        { kind: 'time', name: '점심 식사', before: '12:30', after: '12:00' },
      ]),
    ).toEqual([
      '새로 넣은 곳: 점심 후 휴식',
      '뺀 곳: 이응노미술관',
      '시간 바뀜: 점심 식사 12:30 → 12:00',
    ])
  })

  it('바뀐 것이 없으면 빈 배열', () => {
    expect(formatStopDiff([])).toEqual([])
  })

  it('4개를 넘으면 앞 4개 + 외 n곳', () => {
    const items = [
      { kind: 'added', name: 'A' },
      { kind: 'added', name: 'B' },
      { kind: 'added', name: 'C' },
      { kind: 'added', name: 'D' },
      { kind: 'removed', name: 'E' },
      { kind: 'removed', name: 'F' },
    ] as const

    expect(formatStopDiff([...items])).toEqual([
      '새로 넣은 곳: A',
      '새로 넣은 곳: B',
      '새로 넣은 곳: C',
      '새로 넣은 곳: D',
      '외 2곳',
    ])
  })

  it('4개까지는 그대로', () => {
    const items = [
      { kind: 'added', name: 'A' },
      { kind: 'removed', name: 'B' },
      { kind: 'removed', name: 'C' },
      { kind: 'removed', name: 'D' },
    ] as const

    expect(formatStopDiff([...items])).toHaveLength(4)
    expect(formatStopDiff([...items]).at(-1)).toBe('뺀 곳: D')
  })
})
