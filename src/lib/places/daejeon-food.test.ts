import { describe, expect, it, vi } from 'vitest'
import { collectDaejeonFood, normalizeDaejeonFood, type CachedFoodPage, type FoodPageCache } from './daejeon-food'

const retrievedAt = '2026-11-03T00:00:00.000Z'
const record = (id = 1) => ({ REST_ID: id, REST_NM: `가상 식당 ${id}`, TOB_INFO: '한식',
  ADDR: '대전광역시 가상 주소', LAT: '36.35', LOT: '127.38',
  MENU_KORN_NM: ['가상 국수'], MENU_AMT: ['8,000원'] })
const page = (ids: number[], count: number, next: number | null) => ({ count,
  next: next ? `http://bigdata.daejeon.go.kr/api/stores/?page=${next}` : null,
  previous: null, results: ids.map(record) })
function cache(): FoodPageCache {
  const pages = new Map<number, CachedFoodPage>()
  return { read: async number => pages.get(number) ?? null, write: async (number, value) => { pages.set(number, value) } }
}

describe('대전시 음식점·메뉴 수집', () => {
  it('이름·가격 배열과 위경도·미지 필드를 보존하고 가격 단위를 임의로 정하지 않는다', () => {
    const entry = normalizeDaejeonFood({ ...record(), future: { preserved: true } }, retrievedAt)
    expect(entry.coord).toEqual([127.38, 36.35])
    expect(entry.menus).toEqual([{ name: '가상 국수', priceText: '8,000원', amountKrw: 8000, unit: 'unspecified' }])
    expect(entry.raw.future).toEqual({ preserved: true })
    expect(entry.foodTags).toEqual(['한식'])
    expect(entry.checkedAt).toBe('2026-11-03')
  })

  it('배열 길이가 다르면 다른 메뉴에 가격을 붙이지 않는다', () => {
    const entry = normalizeDaejeonFood({ ...record(), MENU_KORN_NM: ['국수', '수육'] }, retrievedAt)
    expect(entry.menuFieldsAligned).toBe(false)
    expect(entry.menus.every(menu => menu.amountKrw === null && menu.priceText === null)).toBe(true)
    expect(entry.raw.MENU_AMT).toEqual(['8,000원'])
  })

  it.each(['', '0', '무료', '문의', '8,000~10,000원', '100g당 8,000원'])('불명확한 가격은 원문만 보존한다: %s', value => {
    const entry = normalizeDaejeonFood({ ...record(), MENU_AMT: [value] }, retrievedAt)
    expect(entry.menus[0].amountKrw).toBeNull()
  })

  it('업종에 적힌 카페만 분류하고 좌표 누락을 0으로 만들지 않는다', () => {
    expect(normalizeDaejeonFood({ ...record(), TOB_INFO: '카페/디저트', LAT: '' }, retrievedAt))
      .toMatchObject({ kind: 'cafe', coord: null })
    expect(normalizeDaejeonFood({ ...record(), REST_NM: '가상 카페 부대찌개' }, retrievedAt).kind).toBe('food')
  })

  it('한 번 받은 페이지는 재실행 때 외부 호출 없이 사용한다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(page([1, 2], 5, 2)))
      .mockResolvedValueOnce(Response.json(page([3, 4], 5, 3)))
      .mockResolvedValueOnce(Response.json(page([5], 5, null)))
    const store = cache()
    const entries: string[] = []
    const result = await collectDaejeonFood({ fetchFn, cache: store,
      onEntry: async entry => { entries.push(entry.id) } })
    expect(result).toMatchObject({ complete: true, collected: 5, requests: 3, withNumericMenuPrices: 5 })
    expect(entries).toEqual([1, 2, 3, 4, 5].map(id => `daejeon-food-${id}`))
    expect(await collectDaejeonFood({ fetchFn, cache: store, maxRequests: 0 }))
      .toMatchObject({ collected: 5, requests: 0, cacheHits: 3 })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('페이지 도중 실패한 뒤 완료된 캐시부터 이어서 받는다', async () => {
    const store = cache()
    const first = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page([1], 2, 2)))
      .mockRejectedValueOnce(new Error('연결 실패'))
    await expect(collectDaejeonFood({ cache: store, fetchFn: first })).rejects.toThrow()
    const second = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page([2], 2, null)))
    expect(await collectDaejeonFood({ cache: store, fetchFn: second })).toMatchObject({ complete: true, collected: 2, requests: 1, cacheHits: 1 })
  })

  it.each([
    page([1], 2, null),
    { ...page([1], 2, 2), next: 'https://example.test/?page=2' },
  ])('누락된 페이지나 다른 호스트의 주소를 따라가지 않는다', async body => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
    await expect(collectDaejeonFood({ fetchFn })).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('중복 ID와 수집 중 건수 변경을 성공으로 표시하지 않는다', async () => {
    for (const last of [page([1], 2, null), page([2], 3, 3)]) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page([1], 2, 2)))
        .mockResolvedValueOnce(Response.json(last))
      await expect(collectDaejeonFood({ fetchFn })).rejects.toThrow()
    }
  })

  it('외부 요청 상한이 0이면 캐시가 없을 때 호출하지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(collectDaejeonFood({ fetchFn, maxRequests: 0 })).rejects.toThrow()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
