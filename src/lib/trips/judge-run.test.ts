// 버전에 저장할 판정 요약. 숫자는 engine.judge에서만 나오고, 모르면 지어내지 않는다 (AGENTS.md 6장).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stop, traveler } from '@/lib/auth/test-fixtures'
import { hanbat } from '@/lib/engine/test-fixtures'
import { judgeStops, summarizeStops, summaryOf } from './judge-run'
import type { PlaceGeoDeps } from './place-geo'

afterEach(() => {
  vi.restoreAllMocks()
})

const mom = [traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })]

// 한밭수목원만 아는 가짜 장소·경로 (외부 호출 없음). 호출을 세어 볼 수 있다.
function fakeDeps(getLegs: PlaceGeoDeps['getLegs'] = async () => []) {
  return {
    getPlaceDetails: vi.fn<PlaceGeoDeps['getPlaceDetails']>(async ids => (ids.includes(hanbat.id) ? [hanbat] : [])),
    getLegs: vi.fn<PlaceGeoDeps['getLegs']>(getLegs),
  }
}

describe('summaryOf', () => {
  it('판정을 못 돌렸으면 null이다', () => {
    expect(summaryOf({ result: null, places: {}, legs: {} })).toBeNull()
  })
})

describe('summarizeStops', () => {
  it('여행자가 없으면 null이고 장소·경로를 묻지도 않는다', async () => {
    const deps = fakeDeps()

    const summary = await summarizeStops({ stops: [stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id })], travelers: [] }, deps)

    expect(summary).toBeNull()
    expect(deps.getPlaceDetails).not.toHaveBeenCalled()
    expect(deps.getLegs).not.toHaveBeenCalled()
  })

  it('여행자가 있으면 엔진 판정 결과의 요약(판정·이유·하루 총·가장 긴 연속)을 돌려준다', async () => {
    const stops = [stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id })]
    const deps = fakeDeps()

    const summary = await summarizeStops({ stops, travelers: mom }, deps)

    // 서버가 따로 계산하지 않는다 — 엔진 결과와 똑같다
    expect(summary).toEqual(summaryOf(await judgeStops({ stops, travelers: mom }, deps)))
    expect(Object.keys(summary ?? {}).sort()).toEqual(['day', 'longest', 'reason', 'verdict'])
    // 한밭수목원 안의 길을 아니까 정보 부족이 아니고 걷는 시간이 있다
    expect(summary?.verdict).not.toBe('info')
    expect(summary?.day.high).toBeGreaterThan(0)
  })

  it('경로를 하나도 못 받으면 정보 부족이고 걷는 시간을 지어내지 않는다', async () => {
    // 장소 정보가 없는 두 곳 + 걸어가는 이동 → 경로 요청이 1개 생긴다
    const stops = [
      stop({ key: 's1', name: '옛 시장', coord: [127.38, 36.35] }),
      stop({ key: 's2', name: '작은 카페', coord: [127.381, 36.351], arriveBy: 'walk' }),
    ]
    const deps = fakeDeps() // getLegs는 빈 배열 (하나도 못 받음)

    const summary = await summarizeStops({ stops, travelers: mom }, deps)
    const run = await judgeStops({ stops, travelers: mom }, deps)

    expect(deps.getLegs).toHaveBeenCalled()
    expect(run.result?.missingLegs).toHaveLength(1) // 빠진 경로로 알린다
    expect(summary?.verdict).toBe('info')
    expect(summary?.day).toEqual({ base: 0, high: 0 }) // 직선거리 등으로 시간을 채우지 않는다
  })

  it('판정 중 오류가 나면 던지지 않고 null이다 (로그만 남긴다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = fakeDeps()
    deps.getPlaceDetails.mockRejectedValue(new Error('장소 DB 오류'))

    const summary = await summarizeStops({ stops: [stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id })], travelers: mom }, deps)

    expect(summary).toBeNull()
    expect(logged).toHaveBeenCalledTimes(1)
  })
})
