// 기상청 단기예보·중기예보 조회 (공공데이터포털 apis.data.go.kr). 키는 관광지 목록과 같은 TOURAPI_SERVICE_KEY를 쓴다
// (같은 공공데이터포털 계정의 일반 인증키 — 포털에서 두 서비스를 따로 활용신청해야 한다).
// 요청 주소에 키가 들어가므로 주소·오류 객체를 로그에 남기지 않는다.
import 'server-only'
import { z } from 'zod'
import type { WeatherForecast } from '@/lib/contracts'
import { NO_ALERTS, parsePwnStatus, type ParsedAlerts } from './alerts'
import { MidItemSchema, ShortItemSchema, parseMidForecast, parseShortForecast, type MidItem, type ShortItem } from './parse'
import { midTmFc, shortBase } from './time'

const SHORT_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst'
const MID_LAND_URL = 'https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst'
const MID_TA_URL = 'https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa'
// 기상특보 조회서비스 — 특보현황(최근 7일 안의 발효 특보·예비특보). 공공데이터포털에서 따로 활용신청해야 한다
const ALERT_URL = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnStatus'

// 대전광역시 대표 격자 (기상청 "격자_위경도" 표의 대전광역시 행: 67, 100). 서비스가 대전만 다루고,
// 격자 한 칸이 5km라 시내 관광지끼리는 예보가 거의 같아서 한 곳으로 묻는다 (부르는 수도 줄어든다)
export const DAEJEON_GRID = { nx: 67, ny: 100 } as const
// 중기 육상예보 구역 "대전, 세종, 충청남도", 중기 기온 구역 "대전" (중기예보 가이드 첨부 지점코드)
export const DAEJEON_MID_LAND_REG = '11C20000'
export const DAEJEON_MID_TA_REG = '11C20401'

// 단기예보 한 번 발표가 약 1,000줄이라 1,000줄씩 받는다. 넘치면 다음 쪽을 더 받는다
const SHORT_ROWS = 1000
const SHORT_PAGES_MAX = 3
const TIMEOUT_MS = 5000

export type WeatherErrorCode = 'no_key' | 'http' | 'bad_response' | 'no_data' | 'service'

export class WeatherError extends Error {
  constructor(readonly code: WeatherErrorCode) {
    super(`기상청 예보를 받지 못했어요 (${code})`)
    this.name = 'WeatherError'
  }
}

export type WeatherFetch = (url: string, init: { signal: AbortSignal; cache: 'no-store' }) => Promise<Response>

// 공공데이터포털은 "인코딩"·"디코딩" 두 가지 키를 준다. 어느 쪽을 넣었든 한 번만 인코딩되게 맞춘다
// (인코딩 키를 또 인코딩하면 "등록되지 않은 서비스키"가 된다)
export function encodedServiceKey(key: string): string {
  const trimmed = key.trim()
  let raw = trimmed
  if (trimmed.includes('%')) {
    try {
      raw = decodeURIComponent(trimmed)
    } catch {
      raw = trimmed
    }
  }
  return encodeURIComponent(raw)
}

const EnvelopeSchema = z.object({
  response: z.object({
    header: z.object({ resultCode: z.string(), resultMsg: z.string().optional() }),
    body: z
      .object({
        // 자료가 없으면 items가 빈 글자("")로 오기도 하고, 한 건이면 배열이 아닐 수도 있다
        items: z.union([z.object({ item: z.unknown() }), z.literal('')]).optional(),
        totalCount: z.coerce.number().optional(),
      })
      .optional(),
  }),
})

async function callKma<T extends z.ZodTypeAny>(
  fetchFn: WeatherFetch,
  serviceKey: string,
  url: string,
  params: Record<string, string>,
  item: T,
): Promise<{ items: z.infer<T>[]; totalCount: number }> {
  const query = new URLSearchParams({ pageNo: '1', dataType: 'JSON', ...params }).toString()
  const res = await fetchFn(`${url}?serviceKey=${encodedServiceKey(serviceKey)}&${query}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  }).catch(() => {
    throw new WeatherError('http')
  })
  if (!res.ok) throw new WeatherError('http')
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // 키 오류는 JSON을 달라고 해도 XML(OpenAPI_ServiceResponse)로 온다
    throw new WeatherError(/SERVICE_KEY|SERVICE_ACCESS_DENIED|LIMITED_NUMBER/.test(text) ? 'service' : 'bad_response')
  }
  const parsed = EnvelopeSchema.safeParse(json)
  if (!parsed.success) throw new WeatherError('bad_response')
  const { header, body } = parsed.data.response
  if (header.resultCode === '03' || header.resultCode === '3') throw new WeatherError('no_data')
  if (header.resultCode !== '00' && header.resultCode !== '0') throw new WeatherError('service')
  const raw = body?.items && typeof body.items === 'object' ? body.items.item : undefined
  const list: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  // 모양이 다른 줄 하나 때문에 나머지를 버리지 않는다
  const items = list.flatMap(entry => {
    const one = item.safeParse(entry)
    return one.success ? [one.data as z.infer<T>] : []
  })
  return { items, totalCount: body?.totalCount ?? list.length }
}

// 가장 최근 단기예보 (오늘~3·4일 뒤). 날짜별 요약을 돌려준다
export async function fetchShortForecast(fetchFn: WeatherFetch, serviceKey: string, now: Date): Promise<Map<string, WeatherForecast>> {
  const { baseDate, baseTime } = shortBase(now)
  const params = { numOfRows: String(SHORT_ROWS), base_date: baseDate, base_time: baseTime, nx: String(DAEJEON_GRID.nx), ny: String(DAEJEON_GRID.ny) }
  const first = await callKma(fetchFn, serviceKey, SHORT_URL, params, ShortItemSchema)
  const items: ShortItem[] = [...first.items]
  for (let page = 2; items.length < first.totalCount && page <= SHORT_PAGES_MAX; page += 1) {
    const next = await callKma(fetchFn, serviceKey, SHORT_URL, { ...params, pageNo: String(page) }, ShortItemSchema)
    if (next.items.length === 0) break
    items.push(...next.items)
  }
  return parseShortForecast(items)
}

async function fetchMidAt(fetchFn: WeatherFetch, serviceKey: string, tmFc: string): Promise<Map<string, WeatherForecast>> {
  const [land, ta] = await Promise.all([
    callKma(fetchFn, serviceKey, MID_LAND_URL, { numOfRows: '10', regId: DAEJEON_MID_LAND_REG, tmFc }, MidItemSchema),
    // 기온을 못 받아도 하늘·비는 보여 준다
    callKma(fetchFn, serviceKey, MID_TA_URL, { numOfRows: '10', regId: DAEJEON_MID_TA_REG, tmFc }, MidItemSchema).catch(() => null),
  ])
  const landItem: MidItem | undefined = land.items[0]
  if (!landItem) throw new WeatherError('no_data')
  return parseMidForecast(landItem, ta?.items[0] ?? null, tmFc)
}

// 가장 최근 중기예보 (4~10일 뒤). 가장 최근 발표가 아직 안 올라왔으면 그 앞 발표를 쓴다
export async function fetchMidForecast(fetchFn: WeatherFetch, serviceKey: string, now: Date): Promise<Map<string, WeatherForecast>> {
  try {
    return await fetchMidAt(fetchFn, serviceKey, midTmFc(now))
  } catch (error) {
    if (!(error instanceof WeatherError) || error.code !== 'no_data') throw error
    return fetchMidAt(fetchFn, serviceKey, midTmFc(now, 1))
  }
}

// 지금 대전에 걸린 기상특보와 예비특보. 여러 발표가 오면 가장 최근 것을 쓴다. 자료가 없으면(NO_DATA) 특보 없음으로 본다
export async function fetchAlerts(fetchFn: WeatherFetch, serviceKey: string): Promise<ParsedAlerts> {
  let items: MidItem[]
  try {
    items = (await callKma(fetchFn, serviceKey, ALERT_URL, { numOfRows: '10' }, MidItemSchema)).items
  } catch (error) {
    if (error instanceof WeatherError && error.code === 'no_data') return NO_ALERTS
    throw error
  }
  const latest = items.reduce<MidItem | null>((best, item) => (best === null || String(item.tmFc ?? '') > String(best.tmFc ?? '') ? item : best), null)
  return latest ? parsePwnStatus(latest) : NO_ALERTS
}
