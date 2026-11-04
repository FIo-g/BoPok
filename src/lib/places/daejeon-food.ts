import 'server-only'
import { z } from 'zod'

export const DAEJEON_FOOD_SOURCE = 'https://www.data.go.kr/data/15098146/openapi.do'
const API_URL = 'https://bigdata.daejeon.go.kr/api/stores/'
const RecordSchema = z.record(z.string(), z.json())
const ResponseSchema = z.object({
  count: z.number().int().nonnegative(), next: z.url().nullable(),
  results: z.array(RecordSchema),
}).passthrough()
export const CachedFoodPageSchema = z.object({
  pageNo: z.number().int().positive(), retrievedAt: z.iso.datetime(), response: ResponseSchema,
}).strict()
export type CachedFoodPage = z.infer<typeof CachedFoodPageSchema>
type FoodRecord = z.infer<typeof RecordSchema>
export interface FoodPageCache {
  read(pageNo: number): Promise<CachedFoodPage | null>
  write(pageNo: number, page: CachedFoodPage): Promise<void>
}

export class DaejeonFoodError extends Error {
  constructor(message: string) { super(`대전 음식점 API ${message}`); this.name = 'DaejeonFoodError' }
}
function text(record: FoodRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value.trim() || null : typeof value === 'number' ? String(value) : null
}
function strings(record: FoodRecord, key: string): string[] {
  const value = record[key]
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new DaejeonFoodError('메뉴 배열 형식을 확인하지 못했습니다.')
  return value as string[]
}
function price(value: string | null): number | null {
  if (!value || !/^(?:\d+|\d{1,3}(?:,\d{3})+)\s*원?$/.test(value.trim())) return null
  const amount = Number(value.replace(/[,\s원]/g, ''))
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function normalizeDaejeonFood(input: FoodRecord, retrievedAt: string) {
  const raw = RecordSchema.parse(input)
  const sourceId = text(raw, 'REST_ID')
  const name = text(raw, 'REST_NM')
  if (!sourceId || !/^\d+$/.test(sourceId) || !name || !z.iso.datetime().safeParse(retrievedAt).success) {
    throw new DaejeonFoodError('업소 ID·이름·수집 날짜를 확인하지 못했습니다.')
  }
  const menuNames = strings(raw, 'MENU_KORN_NM')
  const menuPrices = strings(raw, 'MENU_AMT')
  const aligned = menuNames.length === menuPrices.length
  const businessType = text(raw, 'TOB_INFO')
  const x = text(raw, 'LOT')
  const y = text(raw, 'LAT')
  const lng = x ? Number(x) : NaN
  const lat = y ? Number(y) : NaN
  const coord: [number, number] | null = Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0 &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null
  const menus = menuNames.map((menuName, index) => ({
    name: menuName, priceText: aligned ? menuPrices[index] || null : null,
    amountKrw: aligned ? price(menuPrices[index]) : null,
    unit: 'unspecified' as const,
  }))
  return {
    id: `daejeon-food-${sourceId}`, sourceId, name,
    kind: businessType && /카페|커피|찻집|다방/.test(businessType) ? 'cafe' as const : 'food' as const,
    businessType, foodTags: businessType ? businessType.split(/[,/|]/).map(tag => tag.trim()).filter(Boolean) : [],
    coord, address: [text(raw, 'ADDR'), text(raw, 'DADDR')].filter(Boolean).join(' ') || null,
    phone: text(raw, 'TELNO'), openingHoursText: text(raw, 'OPEN_HR_INFO'),
    representativeMenu: text(raw, 'RPRS_MENU_NM'), menus, menuFieldsAligned: aligned,
    source: DAEJEON_FOOD_SOURCE, retrievedAt, checkedAt: retrievedAt.slice(0, 10), confidence: 'B' as const,
    providerName: text(raw, 'SD_NM'), providerUrl: text(raw, 'SD_URL'),
    searchText: [name, businessType, text(raw, 'ADDR'), text(raw, 'RPRS_MENU_NM'), ...menuNames]
      .filter(Boolean).join('\n'),
    raw,
  }
}
export type DaejeonFoodEntry = ReturnType<typeof normalizeDaejeonFood>

function checkNext(next: string | null, expected: number | null) {
  if (expected === null) {
    if (next !== null) throw new DaejeonFoodError('마지막 페이지에 다음 페이지가 남아 있습니다.')
    return
  }
  if (!next) throw new DaejeonFoodError('전체 건수보다 페이지가 먼저 끝났습니다.')
  const url = new URL(next)
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'bigdata.daejeon.go.kr' ||
    url.pathname.replace(/\/$/, '') !== '/api/stores' || url.searchParams.get('page') !== String(expected)) {
    throw new DaejeonFoodError('다음 페이지 주소가 공식 API의 예상 페이지와 다릅니다.')
  }
}

export async function collectDaejeonFood(options: {
  fetchFn?: typeof fetch; cache?: FoodPageCache; maxRequests?: number; concurrency?: number
  onEntry?: (entry: DaejeonFoodEntry) => Promise<void>
  onProgress?: (collected: number, total: number, requests: number) => void
} = {}) {
  const maxRequests = options.maxRequests ?? 1000
  const concurrency = options.concurrency ?? 3
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new DaejeonFoodError('요청 상한·동시 요청 설정을 확인해 주세요.')
  }
  let requests = 0
  let cacheHits = 0
  async function load(pageNo: number): Promise<CachedFoodPage> {
    const cached = await options.cache?.read(pageNo)
    if (cached) {
      const result = CachedFoodPageSchema.safeParse(cached)
      if (!result.success || result.data.pageNo !== pageNo) throw new DaejeonFoodError('페이지 캐시 형식이 올바르지 않습니다.')
      cacheHits++
      return result.data
    }
    if (requests >= maxRequests) throw new DaejeonFoodError('이번 실행의 요청 상한에 도달했습니다. 같은 스냅샷으로 이어서 실행해 주세요.')
    requests++
    try {
      const url = new URL(API_URL)
      url.searchParams.set('page', String(pageNo))
      const response = await (options.fetchFn ?? fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } })
      if (!response.ok) throw new DaejeonFoodError(`서버가 HTTP ${response.status}로 응답했습니다.`)
      const body = ResponseSchema.safeParse(await response.json())
      if (!body.success) throw new DaejeonFoodError('응답 형식을 확인하지 못했습니다.')
      const page = { pageNo, retrievedAt: new Date().toISOString(), response: body.data }
      await options.cache?.write(pageNo, page)
      return page
    } catch (error) {
      if (error instanceof DaejeonFoodError) throw error
      throw new DaejeonFoodError('연결 또는 페이지 저장에 실패했습니다. 저장된 페이지는 이어서 사용할 수 있습니다.')
    }
  }
  const first = await load(1)
  const total = first.response.count
  const pageSize = first.response.results.length
  if (total > 0 && pageSize === 0) throw new DaejeonFoodError('목록이 전체 건수보다 먼저 끝났습니다.')
  const pages = pageSize ? Math.ceil(total / pageSize) : 1
  if (pages > 10000) throw new DaejeonFoodError('예상 페이지 수가 너무 큽니다.')
  const ids = new Set<string>()
  const counts = { cafes: 0, withCoord: 0, withMenus: 0, withNumericMenuPrices: 0 }
  async function consume(page: CachedFoodPage) {
    const expectedLength = page.pageNo === pages ? total - (pages - 1) * pageSize : pageSize
    if (page.response.count !== total || page.response.results.length !== expectedLength) {
      throw new DaejeonFoodError('수집 중 전체 건수 또는 페이지 크기가 바뀌었습니다. 새 스냅샷으로 다시 실행해 주세요.')
    }
    checkNext(page.response.next, page.pageNo === pages ? null : page.pageNo + 1)
    for (const record of page.response.results) {
      const entry = normalizeDaejeonFood(record, page.retrievedAt)
      if (ids.has(entry.id)) throw new DaejeonFoodError('페이지 사이에 업소 ID가 중복되었습니다. 새 스냅샷으로 다시 실행해 주세요.')
      await options.onEntry?.(entry)
      ids.add(entry.id)
      if (entry.kind === 'cafe') counts.cafes++
      if (entry.coord) counts.withCoord++
      if (entry.menus.length) counts.withMenus++
      if (entry.menus.some(menu => menu.amountKrw !== null)) counts.withNumericMenuPrices++
    }
    options.onProgress?.(ids.size, total, requests)
  }
  await consume(first)
  for (let start = 2; start <= pages; start += concurrency) {
    const numbers = Array.from({ length: Math.min(concurrency, pages - start + 1) }, (_, index) => start + index)
    // 읽기만 하는 독립 페이지를 제한 병렬로 받되, 기록은 페이지 순서를 유지한다.
    const batch = await Promise.allSettled(numbers.map(load))
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason
      await consume(result.value)
    }
  }
  return { complete: true as const, collected: ids.size, total, ...counts, requests, cacheHits }
}
