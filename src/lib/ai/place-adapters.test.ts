// 장소·경로 어댑터 검사. DB·TMAP은 부르지 않고 가짜 목록·가짜 경로 함수로만 검사한다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest, PlaceSummary } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'
import type { LegsOutcome } from '@/lib/geo/legs'
import {
  createLegsAdapter,
  createPlaceAdapters,
  createPlaceDetailsAdapter,
  findPlaceByName,
  rankCandidates,
} from './place-adapters'
import type { CandidateQuery } from './deps'

function place(id: string, name: string, styles: string[] = []): PlaceSummary {
  return {
    id,
    name,
    category: '테스트',
    styles,
    coord: [127.38, 36.36],
    seated: false,
    indoor: false,
    source: '테스트용',
    checkedAt: '2026-10-31',
    confidence: 'C',
  }
}

// listPlaces가 이름·id 순으로 돌려주는 모양 그대로
const ALL = [
  place('art', '대전시립미술관', ['문화·역사']),
  place('hanbat', '한밭수목원', ['자연·산책', '휴식·힐링']),
  place('leeungno', '이응노미술관', ['문화·역사']),
]

function query(overrides: Partial<CandidateQuery> = {}): CandidateQuery {
  return { styles: [], transport: 'car', avoidStairs: false, limit: 30, ...overrides }
}

describe('rankCandidates (searchCandidates)', () => {
  it('스타일이 맞는 곳을 앞에 두고 나머지도 뒤에 붙인다', () => {
    const ranked = rankCandidates(ALL, query({ styles: ['자연·산책', '휴식·힐링'] }))
    expect(ranked.map(item => item.id)).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('많이 맞는 곳이 먼저, 같으면 원래 순서(이름·id)', () => {
    // 한밭수목원은 두 가지가 맞고(2점), 두 미술관은 한 가지씩(1점)
    const ranked = rankCandidates(ALL, query({ styles: ['문화·역사', '자연·산책', '휴식·힐링'] }))
    expect(ranked.map(item => item.id)).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('스타일이 비어 있으면 원래 순서 그대로', () => {
    expect(rankCandidates(ALL, query()).map(item => item.id)).toEqual(['art', 'hanbat', 'leeungno'])
  })

  it('DB에 없는 스타일(맛집·음식)만 골라도 후보가 비지 않는다', () => {
    expect(rankCandidates(ALL, query({ styles: ['맛집·음식'] }))).toHaveLength(3)
  })

  it('limit만큼만 자른다 (0이면 빈 목록)', () => {
    expect(rankCandidates(ALL, query({ styles: ['자연·산책'], limit: 1 })).map(item => item.id)).toEqual(['hanbat'])
    expect(rankCandidates(ALL, query({ limit: 0 }))).toEqual([])
  })

  it('받은 목록을 바꾸지 않는다', () => {
    const copy = [...ALL]
    rankCandidates(ALL, query({ styles: ['자연·산책'] }))
    expect(ALL).toEqual(copy)
  })
})

describe('findPlaceByName (matchPlaceByName)', () => {
  it('이름이 같으면 맞춘다 (공백 무시)', () => {
    expect(findPlaceByName(ALL, '한밭수목원')?.id).toBe('hanbat')
    expect(findPlaceByName(ALL, ' 한밭 수목원 ')?.id).toBe('hanbat')
  })

  it('입력 안에 장소 이름이 통째로 들어 있으면 맞춘다', () => {
    expect(findPlaceByName(ALL, '10시 한밭수목원 산책')?.id).toBe('hanbat')
    expect(findPlaceByName(ALL, '대전시립미술관에서 전시 관람')?.id).toBe('art')
  })

  it('입력이 장소 이름의 일부일 때("미술관")는 맞추지 않는다', () => {
    expect(findPlaceByName(ALL, '미술관')).toBeNull()
    expect(findPlaceByName(ALL, '수목원')).toBeNull()
  })

  it('DB에 없는 이름이나 빈 입력은 null', () => {
    expect(findPlaceByName(ALL, '성심당 본점')).toBeNull()
    expect(findPlaceByName(ALL, '   ')).toBeNull()
  })

  it('이름이 같은 장소가 둘이면 어느 쪽인지 알 수 없으므로 null', () => {
    const twins = [place('a1', '둘레길'), place('a2', '둘레길')]
    expect(findPlaceByName(twins, '둘레길')).toBeNull()
  })

  it('입력에 들어 있는 장소 이름이 둘이면 더 긴 이름을 고른다', () => {
    const nested = [place('c', '대전'), place('d', '대전시립미술관')]
    expect(findPlaceByName(nested, '대전시립미술관 관람')?.id).toBe('d')
  })

  it('길이가 같은 서로 다른 장소가 둘 다 들어 있으면 null', () => {
    const sameLength = [place('e', '가나다라'), place('f', '마바사아')]
    expect(findPlaceByName(sameLength, '가나다라 다음 마바사아')).toBeNull()
  })

  it('한 글자 이름은 맞추지 않는다', () => {
    expect(findPlaceByName([place('x', '길')], '길 따라 걷기')).toBeNull()
  })
})

describe('createPlaceAdapters', () => {
  it('목록을 한 번씩 읽어 후보·이름 맞추기에 쓴다', async () => {
    const listAll = vi.fn(async () => ALL)
    const adapters = createPlaceAdapters(listAll)

    const candidates = await adapters.searchCandidates(query({ styles: ['자연·산책'], limit: 2 }))
    expect(candidates.map(item => item.id)).toEqual(['hanbat', 'art'])
    expect((await adapters.matchPlaceByName('한밭수목원'))?.id).toBe('hanbat')
    expect(listAll).toHaveBeenCalledTimes(2)
  })

  it('searchPoi는 TMAP POI 검색이 없어 어떤 이름이든 null (좌표를 지어내지 않는다)', async () => {
    const adapters = createPlaceAdapters(async () => ALL)
    await expect(adapters.searchPoi('한밭수목원')).resolves.toBeNull()
    await expect(adapters.searchPoi('아무 데나')).resolves.toBeNull()
  })

  it('목록 읽기가 실패하면 그 오류를 그대로 던진다 (호출하는 쪽이 정보 없음으로 처리)', async () => {
    const adapters = createPlaceAdapters(async () => {
      throw new Error('DB 실패')
    })
    await expect(adapters.matchPlaceByName('한밭수목원')).rejects.toThrow('DB 실패')
  })
})

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
