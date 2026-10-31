// 장소·경로를 부르는 지점의 약속: 못 받은 것은 '없음'으로 두고 판정을 잇는다 (가짜 값으로 채우지 않는다).
// 실제 places·geo(TMAP)는 부르지 않고 가짜 함수를 끼운다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { hanbat } from '@/lib/engine/test-fixtures'
import { GeoError } from '@/lib/geo/errors'
import type { PlaceGeoDeps } from './place-geo'
import { createPlaceGeoDeps } from './place-geo'

afterEach(() => {
  vi.restoreAllMocks()
})

// 좌표가 서로 다른 걷기 요청 (index마다 다른 경로)
function request(index: number): LegRequest {
  return {
    from: { coord: [127.38 + index / 1000, 36.35] },
    to: { coord: [127.39 + index / 1000, 36.36] },
    mode: 'walk',
  }
}

function legOf(one: LegRequest): Leg {
  return {
    key: legKey(one),
    mode: one.mode,
    distanceM: 300,
    path: [one.from.coord, one.to.coord],
    stairsStatus: 'unknown',
    confidence: 'B',
    source: '테스트용 가짜 값',
  }
}

// 한밭수목원만 아는 가짜 source. 호출을 세어 볼 수 있다.
function sourceWith(getLegs: PlaceGeoDeps['getLegs'] = async requests => requests.map(legOf)) {
  return {
    getPlaceDetails: vi.fn<PlaceGeoDeps['getPlaceDetails']>(async ids => (ids.includes(hanbat.id) ? [hanbat] : [])),
    getLegs: vi.fn<PlaceGeoDeps['getLegs']>(getLegs),
  }
}

describe('getPlaceDetails', () => {
  it('중복과 형식이 틀린 id를 빼고 묻는다', async () => {
    const source = sourceWith()

    const details = await createPlaceGeoDeps(source).getPlaceDetails([hanbat.id, hanbat.id, '한밭 수목원', ' '])

    expect(source.getPlaceDetails).toHaveBeenCalledTimes(1)
    expect(source.getPlaceDetails).toHaveBeenCalledWith([hanbat.id])
    expect(details).toEqual([hanbat])
  })

  it('올바른 id가 하나도 없으면 묻지 않고 빈 배열이다', async () => {
    const source = sourceWith()

    await expect(createPlaceGeoDeps(source).getPlaceDetails(['한밭 수목원'])).resolves.toEqual([])
    expect(source.getPlaceDetails).not.toHaveBeenCalled()
  })

  it('100개를 넘으면 나눠서 묻는다', async () => {
    const source = sourceWith()
    const ids = Array.from({ length: 150 }, (_, index) => `place-${index}`)

    await createPlaceGeoDeps(source).getPlaceDetails(ids)

    expect(source.getPlaceDetails.mock.calls.map(call => call[0].length)).toEqual([100, 50])
  })
})

describe('getLegs', () => {
  it('요청이 없으면 아무것도 묻지 않는다', async () => {
    const source = sourceWith()

    await expect(createPlaceGeoDeps(source).getLegs([])).resolves.toEqual([])
    expect(source.getLegs).not.toHaveBeenCalled()
  })

  it('20개씩 나눠 묻고 받은 경로를 이어 붙인다', async () => {
    const source = sourceWith()
    const requests = Array.from({ length: 25 }, (_, index) => request(index))

    const legs = await createPlaceGeoDeps(source).getLegs(requests)

    expect(source.getLegs.mock.calls.map(call => call[0].length)).toEqual([20, 5])
    expect(legs.map(one => one.key)).toEqual(requests.map(legKey))
  })

  it('한 묶음을 하나도 못 받아도(GeoError) 그 묶음만 빼고 이어 간다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    let call = 0
    const source = sourceWith(async requests => {
      call += 1
      if (call === 1) throw new GeoError('upstream', 'TMAP 보행 경로를 받지 못했어요')
      return requests.map(legOf)
    })

    const legs = await createPlaceGeoDeps(source).getLegs(Array.from({ length: 25 }, (_, index) => request(index)))

    expect(legs).toHaveLength(5) // 둘째 묶음(5개)만 받았다
    expect(logged).toHaveBeenCalledWith('[acct] 경로를 받지 못해 빈 값으로 판정', 'upstream')
  })

  it('하나도 못 받으면 던지지 않고 빈 배열이다 (엔진이 missingLegs로 알린다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = sourceWith(async () => {
      throw new GeoError('missing_key', 'TMAP 키가 없어요')
    })

    await expect(createPlaceGeoDeps(source).getLegs([request(0)])).resolves.toEqual([])
    expect(logged).toHaveBeenCalledWith('[acct] 경로를 받지 못해 빈 값으로 판정', 'missing_key')
  })

  it('탈것이 아직 지원되지 않는 것(unsupported_mode)은 정상이라 로그를 남기지 않는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = sourceWith(async () => {
      throw new GeoError('unsupported_mode', '현재는 walk 경로만 지원해요')
    })

    await expect(createPlaceGeoDeps(source).getLegs([{ ...request(0), mode: 'car' }])).resolves.toEqual([])
    expect(logged).not.toHaveBeenCalled()
  })

  it('GeoError가 아닌 오류(DB 등)는 숨기지 않고 그대로 올린다', async () => {
    const source = sourceWith(async () => {
      throw new Error('경로 캐시 DB 오류')
    })

    await expect(createPlaceGeoDeps(source).getLegs([request(0)])).rejects.toThrow('경로 캐시 DB 오류')
  })
})
