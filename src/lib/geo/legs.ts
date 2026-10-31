import 'server-only'
import { legKey, type Leg, type LegRequest } from '@/lib/contracts'
import { createLegCache, type LegCacheStore } from './cache'
import { GeoError } from './errors'
import { getWalkingRoute, type WalkingRoute } from './tmap'
import { LegsInputSchema, TMAP_PEDESTRIAN_URL, WalkingLegSchema } from './validation'

type LegDependencies = { cache?: LegCacheStore; route?: (request: LegRequest) => Promise<WalkingRoute> }

// 경로를 받지 못한 요청 하나. 응답의 Leg 목록에는 넣지 않고 이유만 남긴다.
export type LegFailure = { key: string; error: GeoError }
export type LegsOutcome = { legs: Leg[]; failed: LegFailure[] }

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

  // 항목별로 성공·실패를 나눈다. 입력 모양이 틀린 요청(400)이나 DB 오류(500)는 배치 전체의 오류다.
  async function getLegsPartial(requests: LegRequest[]): Promise<LegsOutcome> {
    const parsed = LegsInputSchema.safeParse({ requests })
    if (!parsed.success) throw new GeoError('invalid_request', '경로 요청을 확인해 주세요. 최대 20개까지 보낼 수 있어요.')
    const unique = new Map<string, LegRequest>()
    for (const request of parsed.data.requests) {
      const key = legKey(request)
      if (!unique.has(key)) unique.set(key, request)
    }
    const walkKeys = [...unique].filter(([, request]) => request.mode === 'walk').map(([key]) => key)
    // 보행 요청이 없으면 cache.read가 DB를 열지 않고 빈 결과를 돌려준다.
    const cached = await cache.read(walkKeys)
    const legs: Leg[] = []
    const failed: LegFailure[] = []
    // 무제한 병렬 호출과 자동 재시도를 피하고, 성공한 경로만 캐시에 저장한다.
    for (const [key, request] of unique) {
      if (request.mode !== 'walk') {
        // 미지원 수단은 캐시·TMAP을 건드리지 않고 이 항목만 실패로 적는다.
        failed.push({ key, error: new GeoError('unsupported_mode', '현재는 walk 경로만 지원해요. car·taxi·bus는 아직 지원하지 않아요.') })
        continue
      }
      const hit = cached.get(key)
      if (hit) {
        legs.push(hit)
        continue
      }
      try {
        legs.push(await fetchLeg(request))
      } catch (error) {
        // 키 없음·외부 오류·시간 초과(GeoError)만 이 항목의 실패다. DB 저장 실패 같은 내부 오류는 그대로 올려 500이 되게 한다.
        if (!(error instanceof GeoError)) throw error
        failed.push({ key, error })
      }
    }
    return { legs, failed }
  }

  async function getLegs(requests: LegRequest[]): Promise<Leg[]> {
    const { legs, failed } = await getLegsPartial(requests)
    // 하나도 받지 못했을 때만 첫 실패를 던진다. 요청이 하나뿐이면 전과 같은 오류·상태 코드가 된다.
    if (legs.length === 0 && failed.length > 0) throw failed[0].error
    return legs
  }

  return Object.assign(getLegs, { partial: getLegsPartial })
}

export const getLegs = createLegService()
export const getLegsPartial = getLegs.partial
