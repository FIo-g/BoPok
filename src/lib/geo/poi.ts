// TMAP 장소(POI) 통합검색 — 붙여넣은 일정의 이름으로 좌표만 찾을 때 쓴다(AI의 searchPoi).
// 좌표는 SK open API가 준 값만 쓰고, 못 찾거나 실패하면 null이다. 직선거리·가짜 좌표로 채우지 않는다.
import 'server-only'
import { z } from 'zod'
import { CoordSchema, type Coord } from '@/lib/contracts'
import { GeoError } from './errors'

export const TMAP_POI_URL = 'https://apis.openapi.sk.com/tmap/pois'

const MAX_KEYWORD_LENGTH = 100
const POI_TIMEOUT_MS = 8000
// 대전을 감싸는 사각형(근사). 정확한 행정경계가 아니라 서울 등 대전 밖 결과를 거르는 1차 안전 장치이고,
// 사각형 안에 걸치는 세종·옥천 등은 아래 주소(upperAddrName) 검사가 한 번 더 거른다.
const DAEJEON_BOUNDS = { minLng: 127.2, maxLng: 127.6, minLat: 36.15, maxLat: 36.52 }

export type PoiResult = { name: string; coord: Coord }
type PoiOptions = { apiKey?: string; fetchFn?: typeof fetch; timeoutMs?: number }

const ResponseSchema = z.object({
  searchPoiInfo: z.object({ pois: z.object({ poi: z.array(z.unknown()) }) }),
})
// TMAP은 좌표를 문자열로 준다. 결과 하나가 이상해도 나머지는 쓸 수 있게 항목마다 따로 검사한다.
const PoiItemSchema = z.object({
  name: z.string().trim().min(1),
  upperAddrName: z.string().optional(),
  noorLon: z.unknown().optional(),
  noorLat: z.unknown().optional(),
  frontLon: z.unknown().optional(),
  frontLat: z.unknown().optional(),
})

// 공백·기호·대소문자를 없앤다 ("한밭 수목원" = "한밭수목원").
function normalizeKeyword(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// [경도, 위도]. 순서가 뒤바뀌거나 범위를 벗어난 값은 CoordSchema가 거른다.
function toCoord(lonValue: unknown, latValue: unknown): Coord | null {
  const lng = toNumber(lonValue)
  const lat = toNumber(latValue)
  if (lng === null || lat === null) return null
  const parsed = CoordSchema.safeParse([lng, lat])
  return parsed.success ? parsed.data : null
}

function inDaejeon([lng, lat]: Coord): boolean {
  return lng >= DAEJEON_BOUNDS.minLng && lng <= DAEJEON_BOUNDS.maxLng
    && lat >= DAEJEON_BOUNDS.minLat && lat <= DAEJEON_BOUNDS.maxLat
}

// 주소가 있으면 대전이어야 한다. 주소가 없는 결과는 좌표 범위만으로 판단한다.
function isDaejeonAddress(upperAddrName: string | undefined): boolean {
  const upper = upperAddrName?.trim()
  return !upper || upper.startsWith('대전')
}

// 조건을 모두 통과한 첫 결과를 돌려준다. 없으면 null(정상적인 "못 찾음"). 응답 모양 자체가 틀리면 upstream 오류.
// 결과 이름에 검색어가 들어 있어야 한다 — 이름이 다른 가까운 곳의 좌표를 그 이름의 좌표로 내놓지 않기 위해서다.
export function parsePoiResponse(value: unknown, keyword: string): PoiResult | null {
  const parsed = ResponseSchema.safeParse(value)
  if (!parsed.success) throw new GeoError('upstream', 'TMAP 장소 검색 응답을 확인하지 못했어요.')
  const wanted = normalizeKeyword(keyword)
  if (wanted.length < 2) return null
  for (const raw of parsed.data.searchPoiInfo.pois.poi) {
    const item = PoiItemSchema.safeParse(raw)
    if (!item.success) continue
    const { name, upperAddrName } = item.data
    if (!normalizeKeyword(name).includes(wanted)) continue
    if (!isDaejeonAddress(upperAddrName)) continue
    const coord = toCoord(item.data.noorLon, item.data.noorLat) ?? toCoord(item.data.frontLon, item.data.frontLat)
    if (coord === null || !inDaejeon(coord)) continue
    return { name, coord }
  }
  return null
}

function buildPoiUrl(keyword: string): string {
  // 검색어는 퍼센트 인코딩해서 주소에 싣는다. 키는 주소에 넣지 않고 헤더로만 보낸다.
  const query = [
    'version=1', `searchKeyword=${encodeURIComponent(keyword)}`, 'searchType=all', 'searchtypCd=A',
    'reqCoordType=WGS84GEO', 'resCoordType=WGS84GEO', 'page=1', 'count=10',
  ].join('&')
  return `${TMAP_POI_URL}?${query}`
}

async function requestPoi(name: string, options: PoiOptions): Promise<PoiResult | null> {
  const keyword = typeof name === 'string' ? name.trim() : ''
  if (keyword.length === 0 || keyword.length > MAX_KEYWORD_LENGTH || normalizeKeyword(keyword).length < 2) {
    throw new GeoError('invalid_request', '찾을 장소 이름을 확인해 주세요.')
  }
  const apiKey = (options.apiKey ?? process.env.TMAP_APP_KEY)?.trim()
  if (!apiKey) throw new GeoError('missing_key', '서버의 TMAP_APP_KEY가 설정되지 않았어요.')
  const timeoutMs = options.timeoutMs ?? POI_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('TMAP 제한 시간이 잘못되었습니다.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await (options.fetchFn ?? fetch)(buildPoiUrl(keyword), {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', appKey: apiKey },
    })
    // 결과가 없으면 TMAP이 본문 없이 204를 줄 수 있다. 오류가 아니라 "못 찾음"이다.
    if (response.status === 204) return null
    if (!response.ok) throw new GeoError('upstream', 'TMAP에서 장소를 검색하지 못했어요.')
    return parsePoiResponse(await response.json(), keyword)
  } catch (error) {
    if (controller.signal.aborted) throw new GeoError('timeout', 'TMAP 장소 검색 요청 시간이 초과됐어요.')
    if (error instanceof GeoError) throw error
    // 요청 헤더나 외부 오류 본문에는 키가 포함될 수 있어 그대로 노출하지 않는다.
    throw new GeoError('upstream', 'TMAP에서 장소를 검색하지 못했어요.')
  } finally { clearTimeout(timer) }
}

// 이름 → 대전 안 장소의 좌표 하나. 키가 없거나 실패하면 null이고 던지지 않는다
// (부르는 쪽이 그 이름을 '정보 없음' 장소로 두면 된다).
export async function searchPoi(name: string, options: PoiOptions = {}): Promise<PoiResult | null> {
  try {
    return await requestPoi(name, options)
  } catch (error) {
    // 키·요청 헤더·외부 오류 원문이 섞일 수 있어 실패 종류만 남긴다.
    console.error('[geo]', 'POI 검색 실패', error instanceof GeoError ? error.kind : 'unknown')
    return null
  }
}
