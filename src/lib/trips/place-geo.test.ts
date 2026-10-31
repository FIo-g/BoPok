// 진짜 장소·경로 연결의 규칙만 본다: 버스를 뺀 구간만 묻고, 한 번에 20개까지 나눠 묻고,
// 실패해도 던지지 않는다. 이동주의 src/lib/geo는 가짜로 바꿔 끼워 TMAP을 부르지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest, PlaceDetail } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'

const getLegsPartial = vi.fn()
const getPlaceDetails = vi.fn<(ids: string[]) => Promise<PlaceDetail[]>>(async () => [])

vi.mock('@/lib/geo/legs', () => ({ getLegsPartial: (requests: LegRequest[]) => getLegsPartial(requests) }))
vi.mock('@/lib/places', () => ({ getPlaceDetails: (ids: string[]) => getPlaceDetails(ids) }))

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

const busRequest: LegRequest = {
  from: { coord: [127.38, 36.35] },
  to: { coord: [127.39, 36.33] },
  mode: 'bus',
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
  getPlaceDetails.mockReset()
  getPlaceDetails.mockImplementation(async () => [])
})

describe('getPlaceDetails (진짜 연결)', () => {
  it('형식이 틀린 id와 중복 id는 빼고 묻는다', async () => {
    await getPlaceGeoDeps().getPlaceDetails(['daejeon-1', 'daejeon-1', 'bad id!', '', 'daejeon-2'])

    expect(getPlaceDetails).toHaveBeenCalledTimes(1)
    expect(getPlaceDetails.mock.calls[0][0]).toEqual(['daejeon-1', 'daejeon-2'])
  })

  it('101개면 100개와 1개로 나눠 두 번 묻는다 (places가 한 번에 100개까지다)', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `place-${index}`)

    await getPlaceGeoDeps().getPlaceDetails(ids)

    expect(getPlaceDetails).toHaveBeenCalledTimes(2)
    expect(getPlaceDetails.mock.calls[0][0]).toHaveLength(100)
    expect(getPlaceDetails.mock.calls[1][0]).toHaveLength(1)
  })
})

describe('getLegs (진짜 연결)', () => {
  it('걷기와 자동차를 함께 묻고 둘 다 결과에 넣는다 (버스만 뺀다)', async () => {
    const legs = await getPlaceGeoDeps().getLegs([walkRequest(0), carRequest])

    expect(getLegsPartial).toHaveBeenCalledTimes(1)
    const sent = getLegsPartial.mock.calls[0][0] as LegRequest[]
    expect(sent.map(request => request.mode).sort()).toEqual(['car', 'walk'])
    expect(legs.map(leg => leg.key).sort()).toEqual([legKey(walkRequest(0)), legKey(carRequest)].sort())
  })

  it('버스 구간만 있으면 아예 부르지 않는다 (geo가 아직 버스를 못 받는다)', async () => {
    const legs = await getPlaceGeoDeps().getLegs([busRequest])
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
