// 장소 상세·경로 어댑터 검사. DB·TMAP은 부르지 않고 가짜 함수로만 검사한다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'
import type { LegsOutcome } from '@/lib/geo/legs'
import { createLegsAdapter, createPlaceDetailsAdapter } from './place-adapters'

describe('createPlaceDetailsAdapter (getPlaceDetails)', () => {
  it('형식이 틀린 id와 중복은 빼고 나머지만 묻는다', async () => {
    const fetchDetails = vi.fn(async () => [])
    const getDetails = createPlaceDetailsAdapter(fetchDetails)

    await getDetails(['hanbat', 'hanbat', '', '../etc', 'a b', 'art'])
    expect(fetchDetails).toHaveBeenCalledWith(['hanbat', 'art'])
  })

  it('쓸 수 있는 id가 없으면 묻지 않고 빈 목록', async () => {
    const fetchDetails = vi.fn(async () => [])
    await expect(createPlaceDetailsAdapter(fetchDetails)(['', '??'])).resolves.toEqual([])
    expect(fetchDetails).not.toHaveBeenCalled()
  })

  it('100개까지만 묻는다', async () => {
    const fetchDetails = vi.fn(async (ids: string[]) => {
      void ids
      return []
    })
    const ids = Array.from({ length: 130 }, (_, index) => `p${index}`)
    await createPlaceDetailsAdapter(fetchDetails)(ids)
    expect(fetchDetails.mock.calls[0][0]).toHaveLength(100)
  })
})

function walkRequest(index: number): LegRequest {
  return { from: { coord: [127.38 + index / 1000, 36.36] }, to: { coord: [127.39 + index / 1000, 36.37] }, mode: 'walk' }
}

function legFor(request: LegRequest): Leg {
  return {
    key: legKey(request),
    mode: request.mode,
    distanceM: 300,
    path: [request.from.coord, request.to.coord],
    stairsStatus: 'unknown',
    source: '테스트용',
    checkedAt: '2026-10-31',
    confidence: 'B',
  }
}

describe('createLegsAdapter (getLegs)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('걷는 구간만 묻는다 — 탈것은 묻지 않고 시간을 지어내지 않는다', async () => {
    const asked: LegRequest[][] = []
    const getLegs = createLegsAdapter(async (requests): Promise<LegsOutcome> => {
      asked.push(requests)
      return { legs: requests.map(legFor), failed: [] }
    })
    const car: LegRequest = { ...walkRequest(5), mode: 'car' }
    const taxi: LegRequest = { ...walkRequest(6), mode: 'taxi' }

    const legs = await getLegs([walkRequest(1), car, taxi, walkRequest(2)])

    expect(asked).toHaveLength(1)
    expect(asked[0].map(request => request.mode)).toEqual(['walk', 'walk'])
    expect(legs.map(leg => leg.mode)).toEqual(['walk', 'walk'])
    expect(legs.every(leg => leg.durationMin === undefined && leg.fareKrw === undefined)).toBe(true)
  })

  it('걷는 구간이 없으면 경로 서비스를 부르지 않는다', async () => {
    const partial = vi.fn(async (): Promise<LegsOutcome> => ({ legs: [], failed: [] }))
    const getLegs = createLegsAdapter(partial)
    await expect(getLegs([{ ...walkRequest(1), mode: 'car' }])).resolves.toEqual([])
    expect(partial).not.toHaveBeenCalled()
  })

  it('20개씩 나눠 묻고 결과를 합친다', async () => {
    const sizes: number[] = []
    const getLegs = createLegsAdapter(async (requests): Promise<LegsOutcome> => {
      sizes.push(requests.length)
      return { legs: requests.map(legFor), failed: [] }
    })
    const legs = await getLegs(Array.from({ length: 45 }, (_, index) => walkRequest(index)))
    expect(sizes).toEqual([20, 20, 5])
    expect(legs).toHaveLength(45)
  })

  it('받지 못한 항목은 빼고 나머지만 돌려준다 (직선거리로 채우지 않는다)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [first, second] = [walkRequest(1), walkRequest(2)]
    const getLegs = createLegsAdapter(async (): Promise<LegsOutcome> => ({
      legs: [legFor(first)],
      failed: [{ key: legKey(second), error: new GeoError('missing_key', '키 없음') }],
    }))

    const legs = await getLegs([first, second])

    expect(legs.map(leg => leg.key)).toEqual([legKey(first)])
    expect(errorSpy).toHaveBeenCalledWith('[ai]', '경로 일부를 받지 못함', 'missing_key')
  })

  it('입력이 잘못된 묶음(GeoError)은 건너뛰고 다른 묶음 결과는 지킨다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let call = 0
    const getLegs = createLegsAdapter(async (requests): Promise<LegsOutcome> => {
      call += 1
      if (call === 2) throw new GeoError('invalid_request', '잘못된 요청')
      return { legs: requests.map(legFor), failed: [] }
    })
    const legs = await getLegs(Array.from({ length: 40 }, (_, index) => walkRequest(index)))
    expect(legs).toHaveLength(20)
  })

  it('DB 오류 같은 내부 오류는 그대로 던진다 (plan-and-save가 정보 부족으로 처리)', async () => {
    const getLegs = createLegsAdapter(async () => {
      throw new Error('DB 저장 실패')
    })
    await expect(getLegs([walkRequest(1)])).rejects.toThrow('DB 저장 실패')
  })
})
