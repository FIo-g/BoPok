// 여러 날 여행의 판정 (설계 2026-11-02 4.2). 걷기 조건은 하루 기준이라 날마다 따로 판정해야 한다.
import { describe, expect, it } from 'vitest'
import { traveler, stop } from '@/lib/auth/test-fixtures'
import type { JudgeResult, LegRequest, Stop } from '@/lib/contracts'
import { hanbat } from '@/lib/engine/test-fixtures'
import { judgeDays, safeSummary, summaryOfDays, type DayRun } from './judge-run'
import type { PlaceGeoDeps } from './place-geo'

const travelers = [traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })]

function recordingDeps(): PlaceGeoDeps & { requests: LegRequest[] } {
  const requests: LegRequest[] = []
  return {
    requests,
    getPlaceDetails: async ids => (ids.includes(hanbat.id) ? [hanbat] : []),
    getLegs: async asked => {
      requests.push(...asked)
      return []
    },
  }
}

const near = (key: string, name: string, day?: number): Stop =>
  stop({ key, name, coord: [127.385, 36.33], arriveBy: 'walk', ...(day ? { day } : {}) })

function dayRun(day: number, verdict: JudgeResult['verdict'], reason: string): DayRun {
  const minutes = { low: day, high: day }
  return {
    day,
    stops: [],
    places: {},
    legs: {},
    result: { verdict, reason, day: minutes, longest: minutes } as unknown as JudgeResult,
  }
}

describe('judgeDays', () => {
  it('날마다 그날 장소만으로 판정한다', async () => {
    const stops = [near('a', '가'), near('b', '나'), near('c', '다', 2)]
    const days = await judgeDays({ stops, travelers }, recordingDeps())

    expect(days.map(run => run.day)).toEqual([1, 2])
    expect(days[0]!.stops.map(one => one.key)).toEqual(['a', 'b'])
    expect(days[1]!.stops.map(one => one.key)).toEqual(['c'])
  })

  it('전날 마지막 장소에서 다음 날 첫 장소로 가는 경로를 묻지 않는다', async () => {
    const deps = recordingDeps()
    await judgeDays({ stops: [near('a', '가'), near('b', '나', 2)], travelers }, deps)

    expect(deps.requests).toEqual([])
  })

  it('빈 일정은 1일차 하나로 본다', async () => {
    const days = await judgeDays({ stops: [], travelers }, recordingDeps())
    expect(days.map(run => run.day)).toEqual([1])
  })

  it('장소가 없는 날은 건너뛴다', async () => {
    const days = await judgeDays({ stops: [near('a', '가'), near('b', '나', 3)], travelers }, recordingDeps())
    expect(days.map(run => run.day)).toEqual([1, 3])
  })
})

describe('summaryOfDays', () => {
  it('하루짜리 요약에는 일차를 붙이지 않는다', () => {
    expect(summaryOfDays([dayRun(1, 'ok', '좋아요')])?.reason).toBe('좋아요')
  })

  it('조건을 넘는 날이 하루라도 있으면 그날을 보여 주고 어느 날인지 밝힌다', () => {
    const summary = summaryOfDays([dayRun(1, 'ok', '좋아요'), dayRun(2, 'adjust', '너무 멀어요'), dayRun(3, 'info', '몰라요')])

    expect(summary?.verdict).toBe('adjust')
    expect(summary?.reason).toBe('2일차: 너무 멀어요')
    expect(summary?.day).toEqual({ low: 2, high: 2 })
  })

  it('조건을 넘는 날이 없으면 정보 부족이 조건 충족보다 앞선다', () => {
    expect(summaryOfDays([dayRun(1, 'ok', '좋아요'), dayRun(2, 'info', '몰라요')])?.verdict).toBe('info')
  })

  it('같은 판정이면 앞선 날을 고른다', () => {
    expect(summaryOfDays([dayRun(1, 'adjust', '첫날'), dayRun(2, 'adjust', '둘째 날')])?.reason).toBe('1일차: 첫날')
  })

  it('판정을 못 돌린 날뿐이면 null', () => {
    expect(summaryOfDays([{ day: 1, stops: [], places: {}, legs: {}, result: null }])).toBeNull()
  })
})

describe('safeSummary', () => {
  it('여러 날 일정의 요약을 만든다', async () => {
    const summary = await safeSummary({ stops: [near('a', '가'), near('b', '나', 2)], travelers }, recordingDeps())
    expect(summary?.reason).toMatch(/^[12]일차: /)
  })
})
