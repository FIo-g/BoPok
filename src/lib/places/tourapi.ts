import 'server-only'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

export const TOURAPI_SOURCE = 'https://www.data.go.kr/data/15101578/openapi.do'
const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2/'
export const TourApiEndpointSchema = z.enum([
  'ldongCode2', 'lclsSystmCode2', 'areaBasedList2', 'detailCommon2',
  'detailIntro2', 'detailInfo2', 'detailImage2', 'detailPetTour2',
])
export type TourApiEndpoint = z.infer<typeof TourApiEndpointSchema>
export const TourApiRecordSchema = z.record(z.string(), z.json())
export type TourApiRecord = z.infer<typeof TourApiRecordSchema>
const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative())
const HeaderSchema = z.object({ response: z.object({
  header: z.object({ resultCode: z.union([z.string(), z.number()]).transform(String) }),
  body: z.unknown().optional(),
}) })
const BodySchema = z.object({
  items: z.union([z.object({ item: z.union([z.array(TourApiRecordSchema), TourApiRecordSchema, z.null()]).optional() }), z.literal(''), z.null()]).optional(),
  pageNo: count, numOfRows: count.optional(), totalCount: count,
})

export const CachedTourApiPageSchema = z.object({
  endpoint: TourApiEndpointSchema,
  params: z.record(z.string(), z.string()),
  retrievedAt: z.iso.datetime(),
  response: z.json(),
}).strict()
export type CachedTourApiPage = z.infer<typeof CachedTourApiPageSchema>
export interface TourApiCache {
  read(key: string): Promise<CachedTourApiPage | null>
  write(key: string, page: CachedTourApiPage): Promise<void>
}
export type TourApiPage = { items: TourApiRecord[]; totalCount: number; pageNo: number;
  endpoint: TourApiEndpoint; retrievedAt: string }

export class TourApiError extends Error {
  constructor(readonly code: 'missing_key' | 'invalid_response' | 'upstream' | 'request_limit' | 'invalid_options', message: string) {
    super(`TourAPI ${message}`)
    this.name = 'TourApiError'
  }
}

function invalidResponse(): never {
  throw new TourApiError('invalid_response', '응답 형식·페이지·전체 건수를 확인하지 못했습니다. 새 스냅샷으로 다시 수집해 주세요.')
}

function parsePage(cached: CachedTourApiPage): TourApiPage {
  const header = HeaderSchema.safeParse(cached.response)
  if (!header.success) return invalidResponse()
  const code = header.data.response.header.resultCode
  if (!['0000', '00', '0'].includes(code)) {
    const safeCode = /^\d{1,4}$/.test(code) ? code : 'unknown'
    throw new TourApiError('upstream', `요청이 거절되었습니다 (결과 코드 ${safeCode}). 활용승인·인증키·호출 한도를 확인해 주세요.`)
  }
  const body = BodySchema.safeParse(header.data.response.body)
  if (!body.success) return invalidResponse()
  const item = typeof body.data.items === 'object' && body.data.items ? body.data.items.item : null
  const items = !item ? [] : Array.isArray(item) ? item : [item]
  return { items, totalCount: body.data.totalCount, pageNo: body.data.pageNo,
    endpoint: cached.endpoint, retrievedAt: cached.retrievedAt }
}

type ClientOptions = { apiKey?: string; fetchFn?: typeof fetch; cache?: TourApiCache;
  maxRequests?: number; minIntervalMs?: number; timeoutMs?: number }

export class TourApiClient {
  private readonly apiKey: string
  private readonly options: Required<Pick<ClientOptions, 'maxRequests' | 'minIntervalMs' | 'timeoutMs'>> & ClientOptions
  private previousRequestAt = 0
  requests = 0
  cacheHits = 0

  constructor(options: ClientOptions = {}) {
    this.options = { maxRequests: 900, minIntervalMs: 200, timeoutMs: 20000, ...options }
    const { maxRequests, minIntervalMs, timeoutMs } = this.options
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 0 || !Number.isFinite(minIntervalMs) || minIntervalMs < 0 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TourApiError('invalid_options', '수집 설정을 확인해 주세요.')
    try {
      const raw = (options.apiKey ?? process.env.TOURAPI_SERVICE_KEY ?? '').trim()
      this.apiKey = raw.includes('%') ? decodeURIComponent(raw) : raw
    } catch {
      throw new TourApiError('invalid_options', '인증키의 인코딩 형식을 확인해 주세요.')
    }
  }

  async all(endpoint: TourApiEndpoint, params: Record<string, string> = {}): Promise<TourApiPage[]> {
    const pages: TourApiPage[] = []
    const fingerprints = new Set<string>()
    let received = 0
    let total: number | null = null
    for (let pageNo = 1; pageNo <= 10000; pageNo++) {
      const page = await this.page(endpoint, { ...params, pageNo: String(pageNo), numOfRows: '100' })
      total ??= page.totalCount
      if (total !== page.totalCount || page.pageNo !== pageNo) return invalidResponse()
      if (!page.items.length && received < total) return invalidResponse()
      const fingerprint = createHash('sha256').update(JSON.stringify(page.items)).digest('hex')
      if (fingerprints.has(fingerprint) || received + page.items.length > total) return invalidResponse()
      fingerprints.add(fingerprint)
      received += page.items.length
      pages.push(page)
      if (received === total) return pages
    }
    return invalidResponse()
  }

  private async page(endpoint: TourApiEndpoint, params: Record<string, string>): Promise<TourApiPage> {
    if (!TourApiEndpointSchema.safeParse(endpoint).success ||
      Object.keys(params).some(key => /servicekey|url|^_/i.test(key))) {
      throw new TourApiError('invalid_options', '허용하지 않은 호출 인자가 있습니다.')
    }
    const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))
    // 파일 이름·진행 기록에는 인증키가 포함된 요청 URL을 쓰지 않는다.
    const cacheKey = `${endpoint}?${new URLSearchParams(sorted)}`
    const previous = await this.options.cache?.read(cacheKey)
    if (previous) {
      const checked = CachedTourApiPageSchema.safeParse(previous)
      if (!checked.success || checked.data.endpoint !== endpoint || JSON.stringify(checked.data.params) !== JSON.stringify(sorted)) return invalidResponse()
      this.cacheHits++
      return parsePage(checked.data)
    }
    if (!this.apiKey) throw new TourApiError('missing_key', 'TOURAPI_SERVICE_KEY가 없습니다. .env.local에 인증키를 설정해 주세요.')
    if (this.requests >= this.options.maxRequests) throw new TourApiError('request_limit', '이번 실행의 요청 상한에 도달했습니다. 저장된 캐시부터 이어서 실행할 수 있습니다.')
    const remaining = this.options.minIntervalMs - (Date.now() - this.previousRequestAt)
    if (remaining > 0) await delay(remaining)
    const url = new URL(endpoint, BASE_URL)
    for (const [key, value] of Object.entries(sorted)) url.searchParams.set(key, value)
    url.searchParams.set('MobileOS', 'ETC')
    url.searchParams.set('MobileApp', 'Bopok')
    url.searchParams.set('_type', 'json')
    url.searchParams.set('serviceKey', this.apiKey)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    let response: z.infer<ReturnType<typeof z.json>>
    this.requests++
    this.previousRequestAt = Date.now()
    try {
      const res = await (this.options.fetchFn ?? fetch)(url, {
        signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        const body = await res.text()
        if (/SERVICE_KEY_IS_NOT_REGISTERED/.test(body)) {
          throw new TourApiError('upstream', '인증키가 등록되지 않았습니다. 국문 관광정보 서비스_GW 활용승인과 인증키 반영 상태를 확인해 주세요.')
        }
        if (/SERVICE_ACCESS_DENIED|PERMISSION_DENIED|NO_OPENAPI_SERVICE/.test(body)) {
          throw new TourApiError('upstream', '국문 관광정보 서비스_GW의 이용 권한이 확인되지 않았습니다.')
        }
        throw new TourApiError('upstream', `서버가 HTTP ${res.status}로 응답했습니다.`)
      }
      const value: unknown = await res.json()
      const json = z.json().safeParse(value)
      if (!json.success) return invalidResponse()
      const serialized = JSON.stringify(value)
      if ([this.apiKey, encodeURIComponent(this.apiKey)].some(key => serialized.includes(key))) return invalidResponse()
      response = json.data
    } catch (error) {
      if (error instanceof TourApiError) throw error
      // fetch·XML 오류에는 인증키와 외부 오류 원문이 섞일 수 있다.
      throw new TourApiError('upstream', '서버 연결 또는 JSON 응답을 확인하지 못했습니다. 인증 상태와 네트워크를 확인해 주세요.')
    } finally {
      clearTimeout(timer)
    }
    const cached: CachedTourApiPage = { endpoint, params: sorted, retrievedAt: new Date().toISOString(), response }
    const parsed = parsePage(cached)
    await this.options.cache?.write(cacheKey, cached)
    return parsed
  }
}
