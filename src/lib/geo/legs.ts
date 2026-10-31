import 'server-only'
import { legKey, type Leg, type LegRequest } from '@/lib/contracts'
import { createLegCache, type LegCacheStore } from './cache'
import { GeoError } from './errors'
import { getWalkingRoute, type WalkingRoute } from './tmap'
import { LegsInputSchema, TMAP_PEDESTRIAN_URL, WalkingLegSchema } from './validation'

type LegDependencies = { cache?: LegCacheStore; route?: (request: LegRequest) => Promise<WalkingRoute> }

export function createLegService(dependencies: LegDependencies = {}) {
  const cache = dependencies.cache ?? createLegCache()
  const route = dependencies.route ?? getWalkingRoute
  const pending = new Map<string, Promise<Leg>>()

  async function fetchLeg(request: LegRequest): Promise<Leg> {
    const key = legKey(request)
    const running = pending.get(key)
    if (running) return running
    const task = (async () => {
      const result = await route(request)
      const leg = WalkingLegSchema.parse({
        key, mode: 'walk', distanceM: result.distanceM, path: result.path,
        source: TMAP_PEDESTRIAN_URL,
        checkedAt: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
        confidence: 'B', stairsStatus: 'unknown',
      })
      await cache.save(leg)
      return leg
    })()
    pending.set(key, task)
    try { return await task } finally { pending.delete(key) }
  }

  return async function getLegs(requests: LegRequest[]): Promise<Leg[]> {
    const parsed = LegsInputSchema.safeParse({ requests })
    if (!parsed.success) throw new GeoError('invalid_request', '경로 요청을 확인해 주세요. 최대 20개까지 보낼 수 있어요.')
    // 미지원 수단이 섞인 요청은 일부를 호출하기 전에 전체를 거절한다.
    if (parsed.data.requests.some(request => request.mode !== 'walk')) {
      throw new GeoError('unsupported_mode', '현재는 walk 경로만 지원해요. car·taxi·bus는 아직 지원하지 않아요.')
    }
    const unique = new Map<string, LegRequest>()
    for (const request of parsed.data.requests) {
      const key = legKey(request)
      if (!unique.has(key)) unique.set(key, request)
    }
    if (!unique.size) return []
    const cached = await cache.read([...unique.keys()])
    const result: Leg[] = []
    // 무제한 병렬 호출과 자동 재시도를 피하고, 성공한 경로만 캐시에 저장한다.
    for (const [key, request] of unique) result.push(cached.get(key) ?? await fetchLeg(request))
    return result
  }
}

export const getLegs = createLegService()
