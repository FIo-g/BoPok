// 진짜 장소·경로 연결의 규칙만 본다: 걷는 구간만 묻고, 한 번에 20개까지 나눠 묻고,
// 실패해도 던지지 않는다. 이동주의 src/lib/geo는 가짜로 바꿔 끼워 TMAP을 부르지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'

const getLegsPartial = vi.fn()

vi.mock('@/lib/geo/legs', () => ({ getLegsPartial: (requests: LegRequest[]) => getLegsPartial(requests) }))
vi.mock('@/lib/places', () => ({ getPlaceDetails: vi.fn(async () => []) }))

const { getPlaceGeoDeps } = await import('./place-geo')

function walkRequest(index: number): LegRequest {
  return {
    from: { coord: [127.38 + index / 1000, 36.35] },
    to: { coord: [127.38 + (index + 1) / 1000, 36.35] },
    mode: 'walk',
  }
}

const carRequest: LegRequest = {
  from: { coord: [127.38, 36.35] },
  to: { coord: [127.39, 36.33] },
  mode: 'car',
}

function okLeg(request: LegRequest): Leg {
  return {
    key: legKey(request),
    mode: 'walk',
    distanceM: 500,
    path: [request.from.coord, request.to.coord],
    stairsStatus: 'unknown',
    confidence: 'B',
  }
}

beforeEach(() => {
  getLegsPartial.mockReset()
  getLegsPartial.mockImplementation(async (requests: LegRequest[]) => ({
    legs: requests.map(okLeg),
    failed: [],
  }))
})

describe('getLegs (진짜 연결)', () => {
  it('걷는 구간만 묻는다 — 자가용은 아예 보내지 않는다', async () => {
    const legs = await getPlaceGeoDeps().getLegs([walkRequest(0), carRequest, walkRequest(1)])

    expect(getLegsPartial).toHaveBeenCalledTimes(1)
    const sent = getLegsPartial.mock.calls[0][0] as LegRequest[]
    expect(sent).toHaveLength(2)
    expect(sent.every(request => request.mode === 'walk')).toBe(true)
    expect(legs).toHaveLength(2)
  })

  it('걷는 구간이 없으면 아예 부르지 않는다', async () => {
    const legs = await getPlaceGeoDeps().getLegs([carRequest])
    expect(getLegsPartial).not.toHaveBeenCalled()
    expect(legs).toEqual([])
  })

  it('20개씩 나눠 묻는다 (geo가 한 번에 20개까지만 받는다)', async () => {
    const requests = Array.from({ length: 21 }, (_, index) => walkRequest(index))

    const legs = await getPlaceGeoDeps().getLegs(requests)

    expect(getLegsPartial).toHaveBeenCalledTimes(2)
    expect((getLegsPartial.mock.calls[0][0] as LegRequest[]).length).toBe(20)
    expect((getLegsPartial.mock.calls[1][0] as LegRequest[]).length).toBe(1)
    expect(legs).toHaveLength(21)
  })

  it('일부 구간이 실패하면 받은 것만 돌려주고 로그를 남긴다 (던지지 않는다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    getLegsPartial.mockImplementation(async (requests: LegRequest[]) => ({
      legs: [okLeg(requests[0])],
      failed: [{ key: legKey(requests[1]), error: new GeoError('upstream', 'TMAP이 응답하지 않아요') }],
    }))

    const legs = await getPlaceGeoDeps().getLegs([walkRequest(0), walkRequest(1)])

    expect(legs).toHaveLength(1) // 못 받은 구간은 '경로 정보 없음'으로 엔진이 본다
    expect(JSON.stringify(logged.mock.calls)).toContain('upstream')
    logged.mockRestore()
  })

  it('배치 전체가 터져도 던지지 않고 빈 결과를 돌려준다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    getLegsPartial.mockRejectedValue(new GeoError('invalid_request', '경로 요청을 확인해 주세요.'))

    await expect(getPlaceGeoDeps().getLegs([walkRequest(0)])).resolves.toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
