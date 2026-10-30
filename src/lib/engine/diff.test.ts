import { describe, expect, it } from 'vitest'
import type { DiffItem, JudgeInput, JudgeResult, Stop, Traveler } from '@/lib/contracts'
import { DiffItemSchema } from '@/lib/contracts'
import { judge } from './judge'
import { diffSummary, fixedChangeSentence, formatDiffItem } from './diff'
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
    const before = judge(notional42())
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
