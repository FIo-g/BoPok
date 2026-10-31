import 'server-only'
import { z } from 'zod'
import { CoordSchema, type Coord, type LegRequest } from '@/lib/contracts'
import { GeoError } from './errors'
import { LegInputSchema, TMAP_PEDESTRIAN_URL } from './validation'

const GeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: CoordSchema }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(CoordSchema).min(2) }),
])
const ResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'), geometry: GeometrySchema,
    properties: z.object({ pointType: z.string().optional(), totalDistance: z.number().finite().positive().optional() }),
  })).min(1),
  error: z.unknown().optional(),
})

function sameCoord(left: Coord, right: Coord): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

export type WalkingRoute = { distanceM: number; path: Coord[] }

export function parseWalkingRoute(value: unknown): WalkingRoute {
  const parsed = ResponseSchema.safeParse(value)
  const invalid = () => new GeoError('upstream', 'TMAP 보행 경로 응답을 확인하지 못했어요.')
  if (!parsed.success || parsed.data.error !== undefined) throw invalid()
  const features = parsed.data.features
  const starts = features.filter(feature => feature.properties.pointType === 'SP')
  const ends = features.filter(feature => feature.properties.pointType === 'EP')
  const start = starts[0]
  const end = ends[0]
  if (starts.length !== 1 || ends.length !== 1 || start.geometry.type !== 'Point' || end.geometry.type !== 'Point') throw invalid()
  const distanceM = start.properties.totalDistance
  if (distanceM === undefined) throw invalid()
  const path: Coord[] = []
  for (const feature of features) {
    if (feature.geometry.type !== 'LineString') continue
    const points = feature.geometry.coordinates
    // 떨어진 선 사이를 직선으로 이어서 가짜 경로를 만들지 않는다.
    if (path.length && !sameCoord(path[path.length - 1], points[0])) throw invalid()
    for (const point of points) {
      if (!path.length || !sameCoord(path[path.length - 1], point)) path.push(point)
    }
  }
  if (path.length < 2 || !sameCoord(path[0], start.geometry.coordinates) || !sameCoord(path[path.length - 1], end.geometry.coordinates)) throw invalid()
  return { distanceM, path }
}

type TmapOptions = { apiKey?: string; fetchFn?: typeof fetch; timeoutMs?: number }

export async function getWalkingRoute(request: LegRequest, options: TmapOptions = {}): Promise<WalkingRoute> {
  const parsed = LegInputSchema.safeParse(request)
  if (!parsed.success) throw new GeoError('invalid_request', '경로의 좌표와 ID를 확인해 주세요.')
  if (parsed.data.mode !== 'walk') throw new GeoError('unsupported_mode', '현재는 walk 경로만 지원해요.')
  const apiKey = (options.apiKey ?? process.env.TMAP_APP_KEY)?.trim()
  if (!apiKey) throw new GeoError('missing_key', '서버의 TMAP_APP_KEY가 설정되지 않았어요.')
  const timeoutMs = options.timeoutMs ?? 8000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('TMAP 제한 시간이 잘못되었습니다.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const { from, to } = parsed.data
    const response = await (options.fetchFn ?? fetch)(TMAP_PEDESTRIAN_URL, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', appKey: apiKey },
      body: JSON.stringify({
        startX: from.coord[0], startY: from.coord[1], endX: to.coord[0], endY: to.coord[1],
        startName: encodeURIComponent('출발 지점'), endName: encodeURIComponent('도착 지점'),
        reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0', sort: 'index',
      }),
    })
    if (!response.ok) throw new GeoError('upstream', 'TMAP에서 보행 경로를 가져오지 못했어요.')
    return parseWalkingRoute(await response.json())
  } catch (error) {
    if (controller.signal.aborted) throw new GeoError('timeout', 'TMAP 보행 경로 요청 시간이 초과됐어요.')
    if (error instanceof GeoError) throw error
    // 요청 헤더나 외부 오류 본문에는 키가 포함될 수 있어 그대로 노출하지 않는다.
    throw new GeoError('upstream', 'TMAP에서 보행 경로를 가져오지 못했어요.')
  } finally { clearTimeout(timer) }
}
