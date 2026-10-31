import 'server-only'
import { legKey, type Leg, type LegRequest } from '@/lib/contracts'
import { createLegCache, type LegCacheStore } from './cache'
import { GeoError } from './errors'
import { getVehicleRoute, getWalkingRoute, type VehicleRoute, type WalkingRoute } from './tmap'
import { LegsInputSchema, TMAP_CAR_URL, TMAP_PEDESTRIAN_URL, VehicleLegSchema, WalkingLegSchema } from './validation'

type LegDependencies = {
  cache?: LegCacheStore
  route?: (request: LegRequest) => Promise<WalkingRoute>
  vehicleRoute?: (request: LegRequest) => Promise<VehicleRoute>
}

// 경로를 받지 못한 요청 하나. 응답의 Leg 목록에는 넣지 않고 이유만 남긴다.
export type LegFailure = { key: string; error: GeoError }
export type LegsOutcome = { legs: Leg[]; failed: LegFailure[] }

const todayKst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

export function createLegService(dependencies: LegDependencies = {}) {
  const cache = dependencies.cache ?? createLegCache()
  const route = dependencies.route ?? getWalkingRoute
  const vehicleRoute = dependencies.vehicleRoute ?? getVehicleRoute
  const pending = new Map<string, Promise<Leg>>()

  async function walkLeg(request: LegRequest, key: string): Promise<Leg> {
    const result = await route(request)
    return WalkingLegSchema.parse({
      key, mode: 'walk', distanceM: result.distanceM, path: result.path,
      source: TMAP_PEDESTRIAN_URL, checkedAt: todayKst(),
      confidence: 'B', stairsStatus: 'unknown',
    })
  }

  // 택시는 자동차와 같은 경로·거리·시간을 쓰고 mode만 다르다. 같은 요청 묶음의 car·taxi가 TMAP을 한 번만 부르도록 car 키로 결과를 나눠 쓴다.
  async function vehicleLeg(request: LegRequest, key: string, shared: Map<string, VehicleRoute>): Promise<Leg> {
    const sharedKey = legKey({ ...request, mode: 'car' })
    let result = shared.get(sharedKey)
    if (!result) {
      result = await vehicleRoute(request)
      shared.set(sharedKey, result)
    }
    return VehicleLegSchema.parse({
      key, mode: request.mode, distanceM: result.distanceM, durationMin: result.durationMin, path: result.path,
      source: TMAP_CAR_URL, checkedAt: todayKst(), confidence: 'B', stairsStatus: 'unknown',
    })
  }

  async function fetchLeg(request: LegRequest, shared: Map<string, VehicleRoute>): Promise<Leg> {
    const key = legKey(request)
    const running = pending.get(key)
    if (running) return running
    const task = (async () => {
      const leg = request.mode === 'walk' ? await walkLeg(request, key) : await vehicleLeg(request, key, shared)
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
    const routedKeys = [...unique].filter(([, request]) => request.mode !== 'bus').map(([key]) => key)
    // 걷기·자동차·택시 요청이 없으면 cache.read가 DB를 열지 않고 빈 결과를 돌려준다.
    const cached = await cache.read(routedKeys)
    const legs: Leg[] = []
    const failed: LegFailure[] = []
    const vehicleRoutes = new Map<string, VehicleRoute>()
    // 시간 초과가 한 번 나면 이 묶음의 나머지 캐시 없는 요청은 TMAP을 부르지 않는다 (전체 지연 제한).
    let timedOut = false
    // 무제한 병렬 호출과 자동 재시도를 피하고, 성공한 경로만 캐시에 저장한다.
    for (const [key, request] of unique) {
      if (request.mode === 'bus') {
        // 미지원 수단은 캐시·TMAP을 건드리지 않고 이 항목만 실패로 적는다.
        failed.push({ key, error: new GeoError('unsupported_mode', '버스(bus) 경로는 아직 지원하지 않아요. walk·car·taxi만 지원해요.') })
        continue
      }
      const hit = cached.get(key)
      if (hit) {
        legs.push(hit)
        continue
      }
      if (timedOut) {
        failed.push({ key, error: new GeoError('timeout', '앞선 TMAP 요청이 시간 초과되어 이 경로는 요청하지 않았어요.') })
        continue
      }
      try {
        legs.push(await fetchLeg(request, vehicleRoutes))
      } catch (error) {
        // 키 없음·외부 오류·시간 초과(GeoError)만 이 항목의 실패다. DB 저장 실패 같은 내부 오류는 그대로 올려 500이 되게 한다.
        if (!(error instanceof GeoError)) throw error
        if (error.kind === 'timeout') timedOut = true
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
