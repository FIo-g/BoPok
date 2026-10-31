import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/legs/route'
import { requireUser } from '@/lib/auth/session'
import { ApiErrorSchema, legKey, LegsResponseSchema, type LegRequest } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { legCache } from '@/lib/db/schema/places'
import { createLegCache, LEG_CACHE_TTL_MS } from './cache'
import { GeoError } from './errors'
import carFixture from './fixtures/tmap-car.json'
import walkFixture from './fixtures/tmap-walk.json'
import { createLegService, getLegs, getLegsPartial } from './legs'
import { parseVehicleRoute, parseWalkingRoute } from './tmap'
import { TMAP_CAR_URL } from './validation'

// 실제 연결 함수만 대체하고 SQL·마이그레이션·API는 구현 그대로 검증한다.
const state = vi.hoisted(() => ({ db: null as Db | null }))
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => {
    if (!state.db) throw new Error('비공개 DB 연결 정보')
    return state.db
  }),
}))
vi.mock('@/lib/auth/session', () => ({ requireUser: vi.fn() }))

const client = new PGlite('memory://')
const db = drizzle(client, { schema })
const cache = createLegCache(db)
const vehicle = parseVehicleRoute(carFixture)
const walkRoute = parseWalkingRoute(walkFixture)
const fetchMock = vi.fn<typeof fetch>()
const todayKst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

const walk: LegRequest = { from: { coord: [127.38, 36.36] }, to: { coord: [127.382, 36.362] }, mode: 'walk' }
const car: LegRequest = { ...walk, mode: 'car' }
const taxi: LegRequest = { ...walk, mode: 'taxi' }
const bus: LegRequest = { ...walk, mode: 'bus' }
// 좌표가 다른 구간. 경도가 다르면 캐시 키가 달라진다.
const elsewhere = (mode: LegRequest['mode'], lng: number): LegRequest => ({ from: { coord: [lng, 36.37] }, to: { coord: [lng + 0.002, 36.372] }, mode })
const http = (body: unknown) => POST(new Request('http://localhost/api/legs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))
// 실제 8초를 기다리지 않고 AbortController의 시간 초과 상태를 모사한다. 다음 fetch 한 번만 시간 초과가 된다.
function timeoutNextFetch() {
  fetchMock.mockImplementationOnce(async (_url, init) => {
    Object.defineProperty(init?.signal, 'aborted', { value: true })
    throw new DOMException('목업 시간 초과', 'AbortError')
  })
}

beforeAll(async () => { await migrate(db, { migrationsFolder: './drizzle' }) }, 30000)
beforeEach(async () => {
  state.db = db
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: 'test-user', userName: '테스트 사용자' })
  vi.stubEnv('TMAP_APP_KEY', 'fixture')
  fetchMock.mockReset().mockImplementation(async url => Response.json(String(url) === TMAP_CAR_URL ? carFixture : walkFixture))
  vi.stubGlobal('fetch', fetchMock)
  // 새 memory://의 캐시만 비운다. 기존 로컬 데이터와 외부 DB에는 접근하지 않는다.
  await db.execute(sql`truncate table leg_cache`)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await client.close() })

describe('자동차·택시 경로', () => {
  it('car는 거리·소요 시간·경로를 계약대로 돌려주고 택시 요금·계단 확인은 만들지 않는다', async () => {
    const result = await getLegs([car])
    expect(LegsResponseSchema.safeParse(result).success).toBe(true)
    expect(result).toEqual([expect.objectContaining({
      key: legKey(car), mode: 'car', distanceM: 4200, durationMin: 13, path: vehicle.path,
      stairsStatus: 'unknown', source: TMAP_CAR_URL, confidence: 'B',
    })])
    expect(result[0].checkedAt).toBe(todayKst())
    expect(result[0]).not.toHaveProperty('fareKrw')
    expect(result[0]).not.toHaveProperty('stairsCount')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(TMAP_CAR_URL)
  })

  it('taxi는 car와 같은 경로·거리·시간에 mode만 taxi이고, TMAP이 택시 요금을 줘도 fareKrw를 만들지 않는다', async () => {
    expect(carFixture.features[0].properties).toMatchObject({ taxiFare: 7200 })
    const [leg] = await getLegs([taxi])
    expect(leg).toMatchObject({ key: legKey(taxi), mode: 'taxi', distanceM: 4200, durationMin: 13, path: vehicle.path, stairsStatus: 'unknown' })
    expect(leg).not.toHaveProperty('fareKrw')
    expect(fetchMock.mock.calls[0][0]).toBe(TMAP_CAR_URL)
  })

  it('성공한 car를 leg_cache에 저장하고 다른 서비스 인스턴스는 키 없이 재사용한다', async () => {
    const first = await getLegs([car])
    const rows = await db.select().from(legCache)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: legKey(car), mode: 'car', distanceM: 4200, durationMin: 13, stairsStatus: 'unknown',
      stairsCount: null, fareKrw: null, source: TMAP_CAR_URL, confidence: 'B',
    })
    expect(rows[0].fetchedAt).toBeInstanceOf(Date)
    vi.stubEnv('TMAP_APP_KEY', '')
    const another = createLegService({ cache: createLegCache(db) })
    expect(await another([car])).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('24시간 이상 지난 자동차 캐시는 재사용하지 않고 새 경로가 성공한 뒤 갱신한다', async () => {
    await getLegs([car])
    const oldTime = new Date(Date.now() - LEG_CACHE_TTL_MS - 1000)
    await db.update(legCache).set({ fetchedAt: oldTime }).where(eq(legCache.key, legKey(car)))
    expect((await cache.read([legKey(car)])).has(legKey(car))).toBe(false)
    await getLegs([car])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((await db.select().from(legCache))[0].fetchedAt.getTime()).toBeGreaterThan(oldTime.getTime())
  })

  it('계약에 맞지 않는 자동차 캐시(시간 없음·택시 요금·계단 없음 확인·다른 출처)는 재사용하지 않고 정상 경로로 갱신한다', async () => {
    await getLegs([car])
    for (const change of [{ durationMin: null }, { fareKrw: 5000 }, { stairsStatus: 'confirmed_none' as const }, { source: '테스트 실험 출처' }]) {
      await db.update(legCache).set(change).where(eq(legCache.key, legKey(car)))
      const before = fetchMock.mock.calls.length
      const [leg] = await getLegs([car])
      expect(leg.durationMin).toBe(13)
      expect(fetchMock).toHaveBeenCalledTimes(before + 1)
    }
    expect(await db.select().from(legCache)).toHaveLength(1)
  })

  it('같은 구간의 car와 taxi가 한 묶음에 있으면 TMAP은 한 번만 부르고 캐시 행은 따로 저장한다', async () => {
    const result = await getLegs([car, taxi])
    expect(result.map(leg => [leg.key, leg.mode])).toEqual([[legKey(car), 'car'], [legKey(taxi), 'taxi']])
    expect(result[1]).toMatchObject({ distanceM: result[0].distanceM, durationMin: result[0].durationMin, path: result[0].path })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await db.select().from(legCache)).map(row => row.key).sort()).toEqual([legKey(car), legKey(taxi)].sort())
  })

  it('bus는 계속 미지원이다 — 키·DB·외부 호출 없이 그 항목만 실패로 적는다', async () => {
    state.db = null
    await expect(getLegs([bus])).rejects.toMatchObject({ kind: 'unsupported_mode' })
    expect(await getLegsPartial([bus])).toEqual({ legs: [], failed: [{ key: legKey(bus), error: expect.objectContaining({ kind: 'unsupported_mode' }) }] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('걷기(캐시) + car + bus + taxi(다른 구간)가 섞이면 bus만 실패하고 나머지는 받는다', async () => {
    await getLegs([walk]) // 걷기 1: 캐시에 저장
    fetchMock.mockClear()
    const farTaxi = elsewhere('taxi', 127.39)
    const outcome = await getLegsPartial([walk, car, bus, farTaxi])
    expect(outcome.legs.map(leg => leg.key)).toEqual([legKey(walk), legKey(car), legKey(farTaxi)])
    expect(outcome.failed.map(item => [item.key, item.error.kind])).toEqual([[legKey(bus), 'unsupported_mode']])
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([TMAP_CAR_URL, TMAP_CAR_URL])
    expect((await db.select().from(legCache)).map(row => row.key).sort()).toEqual([legKey(walk), legKey(car), legKey(farTaxi)].sort())
  })

  it('POST /api/legs도 섞인 묶음은 200으로 받은 경로만 돌려주고, bus뿐이면 422다', async () => {
    const response = await http({ requests: [walk, car, bus] })
    expect(response.status).toBe(200)
    expect(LegsResponseSchema.parse(await response.json()).map(leg => leg.key)).toEqual([legKey(walk), legKey(car)])
    expect((await http({ requests: [bus] })).status).toBe(422)
  })
})

describe('시간 초과 뒤 건너뛰기', () => {
  it('시간 초과가 한 번 나면 같은 묶음의 나머지 캐시 없는 요청은 TMAP을 부르지 않고 timeout 실패로 뺀다', async () => {
    const cachedWalk = elsewhere('walk', 127.4)
    const okWalk = elsewhere('walk', 127.41)
    const slowCar = elsewhere('car', 127.42)
    const skippedCar = elsewhere('car', 127.43)
    const skippedWalk = elsewhere('walk', 127.44)
    const routeMock = vi.fn().mockResolvedValue(walkRoute)
    const vehicleMock = vi.fn().mockRejectedValueOnce(new GeoError('timeout', '목업 시간 초과'))
    const service = createLegService({ cache, route: routeMock, vehicleRoute: vehicleMock })
    await service([cachedWalk]) // 캐시에 미리 저장
    routeMock.mockClear()
    const outcome = await service.partial([okWalk, slowCar, skippedCar, bus, skippedWalk, cachedWalk])
    // 성공한 것과 캐시에 있는 것은 그대로 돌려준다.
    expect(outcome.legs.map(leg => leg.key)).toEqual([legKey(okWalk), legKey(cachedWalk)])
    expect(outcome.failed.map(item => [item.key, item.error.kind])).toEqual([
      [legKey(slowCar), 'timeout'], [legKey(skippedCar), 'timeout'],
      [legKey(bus), 'unsupported_mode'], [legKey(skippedWalk), 'timeout'],
    ])
    expect(routeMock).toHaveBeenCalledTimes(1) // okWalk만
    expect(vehicleMock).toHaveBeenCalledTimes(1) // slowCar만
    expect((await db.select().from(legCache)).map(row => row.key).sort()).toEqual([legKey(cachedWalk), legKey(okWalk)].sort())
  })

  it('시간 초과가 아닌 실패(외부 오류)는 다음 요청을 막지 않는다', async () => {
    const first = elsewhere('car', 127.45)
    const second = elsewhere('car', 127.46)
    const vehicleMock = vi.fn().mockRejectedValueOnce(new GeoError('upstream', '목업 실패')).mockResolvedValueOnce(vehicle)
    const service = createLegService({ cache, vehicleRoute: vehicleMock })
    const outcome = await service.partial([first, second])
    expect(outcome.legs.map(leg => leg.key)).toEqual([legKey(second)])
    expect(outcome.failed.map(item => [item.key, item.error.kind])).toEqual([[legKey(first), 'upstream']])
    expect(vehicleMock).toHaveBeenCalledTimes(2)
  })

  it('POST /api/legs: 실제 TMAP 호출 코드에서 시간 초과가 나면 나머지는 fetch하지 않고, 하나도 못 받으면 504다', async () => {
    await http({ requests: [walk] }) // 걷기 캐시 저장
    const first = elsewhere('car', 127.47)
    const second = elsewhere('car', 127.48)
    fetchMock.mockClear()
    timeoutNextFetch()
    const mixed = await http({ requests: [first, walk, second] })
    expect(mixed.status).toBe(200)
    expect(LegsResponseSchema.parse(await mixed.json()).map(leg => leg.key)).toEqual([legKey(walk)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockClear()
    timeoutNextFetch()
    const failed = await http({ requests: [first, second] })
    expect(failed.status).toBe(504)
    expect(ApiErrorSchema.parse(await failed.json()).error.code).toBe('external_api_failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await db.select().from(legCache)).map(row => row.key)).toEqual([legKey(walk)])
  })
})
