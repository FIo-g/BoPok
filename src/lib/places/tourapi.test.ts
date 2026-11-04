import { describe, expect, it, vi } from 'vitest'
import { collectServiceCatalog, normalizeServicePlace } from './service-catalog'
import { TourApiClient, TourApiError, type CachedTourApiPage, type TourApiCache } from './tourapi'

// 실제 업체나 실제 API 응답이 아닌, 페이지·필드 처리를 검증하는 가상 자료다.
function envelope(items: Record<string, unknown>[], totalCount = items.length, pageNo = 1) {
  return { response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: {
    items: items.length ? { item: items } : '', numOfRows: 100, pageNo, totalCount,
  } } }
}

function memoryCache(): TourApiCache {
  const pages = new Map<string, CachedTourApiPage>()
  return {
    read: async key => pages.get(key) ?? null,
    write: async (key, value) => { pages.set(key, value) },
  }
}

describe('TourAPI 수집 클라이언트', () => {
  it('숫자 문자열·단일 항목·빈 목록을 처리하고 모든 페이지를 받는다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ response: {
        header: { resultCode: '0000' }, body: {
          items: { item: { contentid: '1', futureField: { preserved: true } } },
          pageNo: '1', numOfRows: '1', totalCount: '2',
        },
      } }))
      .mockResolvedValueOnce(Response.json(envelope([{ contentid: '2' }], 2, 2)))
      .mockResolvedValueOnce(Response.json(envelope([])))
    const api = new TourApiClient({ apiKey: 'test-only', fetchFn, minIntervalMs: 0 })
    const pages = await api.all('areaBasedList2', { lDongRegnCd: '30', contentTypeId: '39' })
    expect(pages.flatMap(page => page.items)).toEqual([
      { contentid: '1', futureField: { preserved: true } }, { contentid: '2' },
    ])
    expect((await api.all('detailInfo2', { contentId: '1', contentTypeId: '39' }))[0].items).toEqual([])
    const url = new URL(String(fetchFn.mock.calls[1][0]))
    expect(url.searchParams.get('pageNo')).toBe('2')
    expect(url.searchParams.get('lDongRegnCd')).toBe('30')
    expect(url.searchParams.has('areaCode')).toBe(false)
  })

  it('캐시에는 키를 넣지 않으며, 키 없는 별도 클라이언트도 저장 응답을 재사용한다', async () => {
    const cache = memoryCache()
    const write = vi.spyOn(cache, 'write')
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope([{ name: '대전광역시', code: '30' }])))
    const api = new TourApiClient({ apiKey: 'test+only/secret==', fetchFn, cache, minIntervalMs: 0 })
    const first = await api.all('ldongCode2')
    const second = await new TourApiClient({ apiKey: '', cache, fetchFn }).all('ldongCode2')
    expect(second).toEqual(first)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(write.mock.calls)).not.toContain('secret')
    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('serviceKey')).toBe('test+only/secret==')
  })

  it('Encoding 키도 한 번만 디코딩해 이중 인코딩을 방지한다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope([])))
    await new TourApiClient({ apiKey: 'test%2Bonly%2Fsecret%3D%3D', fetchFn }).all('ldongCode2')
    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('serviceKey')).toBe('test+only/secret==')
  })

  it('요청 상한을 넘으면 추가 호출 없이 멈추며 캐시 조회는 상한에 포함하지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope([])))
    const api = new TourApiClient({ apiKey: 'test-only', fetchFn, cache: memoryCache(), maxRequests: 1 })
    await api.all('ldongCode2')
    await api.all('ldongCode2')
    await expect(api.all('lclsSystmCode2')).rejects.toMatchObject({ code: 'request_limit' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it.each([
    { response: { header: { resultCode: '22', resultMsg: 'test-secret 인증 원문' } } },
    { response: { header: { resultCode: '0000' }, body: { items: '', pageNo: 1, totalCount: 5 } } },
    { response: { header: { resultCode: '0000' }, body: { items: '', pageNo: 1, totalCount: -1 } } },
  ])('인증·한도·잘못된 응답은 외부 원문 없이 실패한다', async body => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
    try {
      await new TourApiClient({ apiKey: 'test-secret', fetchFn }).all('ldongCode2')
      expect.fail('실패해야 한다')
    } catch (error) {
      expect(error).toBeInstanceOf(TourApiError)
      expect(String(error)).not.toContain('test-secret')
      expect(String(error)).not.toContain('인증 원문')
    }
  })

  it('XML 인증 오류와 fetch 예외에도 키·URL을 출력하지 않는다', async () => {
    for (const fetchFn of [
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<error>test-secret</error>')),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('https://example.test/?serviceKey=test-secret')),
    ]) {
      await expect(new TourApiClient({ apiKey: 'test-secret', fetchFn }).all('ldongCode2'))
        .rejects.toThrow(/^TourAPI/)
    }
  })

  it('응답에 인증키가 섞여 있으면 디스크 캐시에 기록하지 않는다', async () => {
    const cache = memoryCache()
    const write = vi.spyOn(cache, 'write')
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope([{ value: 'test-secret' }])))
    await expect(new TourApiClient({ apiKey: 'test-secret', fetchFn, cache }).all('ldongCode2')).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  })

  it('등록되지 않은 키의 HTTP 403은 원문을 숨기고 활용승인 확인을 안내한다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: 'SERVICE_KEY_IS_NOT_REGISTERED', unsafe: 'test-secret',
    }, { status: 403 }))
    const error = await new TourApiClient({ apiKey: 'test-secret', fetchFn }).all('ldongCode2').catch(error => error)
    expect(error).toBeInstanceOf(TourApiError)
    expect(error.message).toContain('활용승인')
    expect(error.message).not.toContain('test-secret')
  })

  it('페이지 반복·전체 건수 변경·페이지 번호 불일치를 완료로 처리하지 않는다', async () => {
    for (const second of [envelope([{ id: 'a' }], 2, 2), envelope([{ id: 'b' }], 3, 2), envelope([{ id: 'b' }], 2, 1)]) {
      const fetchFn = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(envelope([{ id: 'a' }], 2)))
        .mockResolvedValueOnce(Response.json(second))
      await expect(new TourApiClient({ apiKey: 'test-only', fetchFn, minIntervalMs: 0 }).all('ldongCode2'))
        .rejects.toMatchObject({ code: 'invalid_response' })
    }
  })
})

describe('대전 식당·카페·숙박 원본과 추천용 자료', () => {
  const source = [{ endpoint: 'detailIntro2' as const, retrievedAt: '2026-11-03T00:00:00.000Z' }]
  const food = { contentid: '100', contenttypeid: '39', title: '가상 찻집',
    lDongRegnCd: '30', lclsSystm3: 'MOCK_CAFE', mapx: '127.38', mapy: '36.36' }

  it('메뉴·영업시간·분류·미래 필드는 보존하고 음식 성질이나 가격을 만들지 않는다', () => {
    const entry = normalizeServicePlace({ list: food, common: [{ overview: '가상 소개' }],
      intro: [{ firstmenu: '차', treatmenu: '차 / 떡<br>계절 메뉴', opentimefood: '10:00~18:00', future: '보존' }],
      details: [{ infoname: '메뉴', infotext: '떡 2인분 12,000원' }], images: [], menuImages: [], pet: [],
    }, [{ lclsSystm3Cd: 'MOCK_CAFE', lclsSystm3Nm: '카페' }], source)
    expect(entry.kind).toBe('cafe')
    expect(entry.coord).toEqual([127.38, 36.36])
    expect(entry.food?.menusText).toBe('차 / 떡 계절 메뉴')
    expect(entry.food?.menuAndPriceNotes).toEqual([{ label: '메뉴', text: '떡 2인분 12,000원' }])
    expect(entry.raw.intro[0].future).toBe('보존')
    expect(entry.searchText).toContain('계절 메뉴')
    expect(entry).not.toHaveProperty('stairsStatus')
    expect(entry.food).not.toHaveProperty('allergenFree')
    expect(entry.food).not.toHaveProperty('priceKrw')
  })

  it('숙박비는 객실당 1박·시기별 기준으로 보존하며 0·문의·범위는 미확인이다', () => {
    const entry = normalizeServicePlace({ list: { ...food, contenttypeid: '32' }, common: [], intro: [],
      details: [{ roomcode: 'A', roomtitle: '가상 객실', roombasecount: '2', roommaxcount: '4',
        roomoffseasonminfee1: '80,000', roomoffseasonminfee2: '0',
        roompeakseasonminfee1: '전화문의', roompeakseasonminfee2: '100000~200000' }],
      images: [], menuImages: [], pet: [],
    }, [], source)
    expect(entry.lodging?.rooms[0]).toMatchObject({
      baseGuests: 2, maxGuests: 4, unit: 'room_per_night', liveQuote: false,
      publishedRates: { offSeasonWeekday: { amountKrw: 80000 }, offSeasonWeekend: { amountKrw: null },
        peakSeasonWeekday: { amountKrw: null }, peakSeasonWeekend: { amountKrw: null } },
    })
  })

  it.each([{ mapx: '', mapy: '' }, { mapx: '0', mapy: '0' }, { mapx: '36.36', mapy: '127.38' }])(
    '누락·0·뒤집힌 좌표를 추천용 좌표로 만들지 않는다: %j', coord => {
      expect(normalizeServicePlace({ list: { ...food, ...coord }, common: [], intro: [], details: [],
        images: [], menuImages: [], pet: [] }, [], source).coord).toBeNull()
    },
  )

  it('목록과 다른 ID·분류·지역이 섞이면 실패한다', () => {
    for (const common of [[{ contentid: '999' }], [{ contenttypeid: '32' }], [{ lDongRegnCd: '11' }]]) {
      expect(() => normalizeServicePlace({ list: food, common, intro: [], details: [], images: [], menuImages: [], pet: [] }, [], source)).toThrow()
    }
  })

  it('법정동 코드로 대전만 수집하고 음식 메뉴 이미지와 숙박 반복정보도 전부 받는다', async () => {
    const fetchFn = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input))
      const endpoint = url.pathname.split('/').at(-1)
      if (endpoint === 'ldongCode2') return Response.json(envelope([{ code: '30', name: '대전광역시' }]))
      if (endpoint === 'lclsSystmCode2') return Response.json(envelope([]))
      if (endpoint === 'areaBasedList2') {
        expect(url.searchParams.get('lDongRegnCd')).toBe('30')
        const type = url.searchParams.get('contentTypeId')!
        return Response.json(envelope([{ ...food, contentid: type, contenttypeid: type }]))
      }
      return Response.json(envelope([]))
    })
    const entries: string[] = []
    const result = await collectServiceCatalog(new TourApiClient({ apiKey: 'test-only', fetchFn, minIntervalMs: 0 }), {
      onEntry: async entry => { entries.push(entry.id) },
    })
    expect(result.complete).toBe(true)
    expect(entries).toEqual(['tourapi-32-32', 'tourapi-39-39'])
    const urls = fetchFn.mock.calls.map(([url]) => new URL(String(url)))
    expect(urls.filter(url => url.pathname.endsWith('/detailImage2') && url.searchParams.get('imageYN') === 'N')).toHaveLength(1)
    expect(urls.filter(url => url.pathname.endsWith('/detailInfo2'))).toHaveLength(2)
  })

  it('숙박만 선택하면 음식점 목록과 메뉴 이미지는 요청하지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/ldongCode2')) return Response.json(envelope([{ code: '30', name: '대전광역시' }]))
      if (url.pathname.endsWith('/areaBasedList2')) expect(url.searchParams.get('contentTypeId')).toBe('32')
      return Response.json(envelope([]))
    })
    const result = await collectServiceCatalog(new TourApiClient({ apiKey: 'test-only', fetchFn, minIntervalMs: 0 }), { contentTypes: ['32'] })
    expect(result.contentTypes).toEqual(['32'])
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })
})
