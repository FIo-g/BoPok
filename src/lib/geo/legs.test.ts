import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/legs/route'
import { HttpError } from '@/lib/auth/http'
import { requireUser } from '@/lib/auth/session'
import { ApiErrorSchema, legKey, LegsResponseSchema, type LegRequest, type PlaceDetail, type Stop } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { legCache } from '@/lib/db/schema/places'
import { requiredLegs } from '@/lib/engine/required-legs'
import { createLegCache, LEG_CACHE_TTL_MS } from './cache'
import { GeoError } from './errors'
import fixture from './fixtures/tmap-walk.json'
import { createLegService, getLegs, getLegsPartial } from './legs'
import { parseWalkingRoute } from './tmap'
import { TMAP_PEDESTRIAN_URL } from './validation'

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
const request: LegRequest = { from: { coord: [127.38, 36.36] }, to: { coord: [127.382, 36.362] }, mode: 'walk' }
const route = parseWalkingRoute(fixture)
const cache = createLegCache(db)
const fetchMock = vi.fn<typeof fetch>()
const http = (body: unknown) => POST(new Request('http://localhost/api/legs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))

beforeAll(async () => { await migrate(db, { migrationsFolder: './drizzle' }) }, 30000)
beforeEach(async () => {
  state.db = db
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: 'test-user', userName: '테스트 사용자' })
  vi.stubEnv('TMAP_APP_KEY', 'fixture')
  fetchMock.mockReset().mockImplementation(async () => Response.json(fixture))
  vi.stubGlobal('fetch', fetchMock)
  // 새 memory://의 캐시만 비운다. 기존 로컬 데이터와 외부 DB에는 접근하지 않는다.
  await db.execute(sql`truncate table leg_cache`)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => { await client.close() })

describe('getLegs와 실제 메모리 leg_cache', () => {
  it('기존 계약의 키·거리·경로·출처를 저장하고 보행 시간과 계단 확인 값을 만들지 않는다', async () => {
    const result = await getLegs([request])
    expect(LegsResponseSchema.safeParse(result).success).toBe(true)
    expect(result).toEqual([expect.objectContaining({
      key: legKey(request), mode: 'walk', distanceM: 300, path: route.path,
      stairsStatus: 'unknown', source: TMAP_PEDESTRIAN_URL, confidence: 'B',
    })])
    expect(result[0].checkedAt).toBe(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()))
    expect(result[0]).not.toHaveProperty('durationMin')
    expect(result[0]).not.toHaveProperty('stairsCount')
    expect(result[0]).not.toHaveProperty('fareKrw')
    const [row] = await db.select().from(legCache)
    expect(row).toMatchObject({ key: legKey(request), distanceM: 300, stairsStatus: 'unknown', durationMin: null, stairsCount: null })
    expect(row.fetchedAt).toBeInstanceOf(Date)
  })

  it('같은 배치의 중복은 처음 요청 하나만 호출하고 결과도 한 번 반환한다', async () => {
    const similar: LegRequest = { ...request, from: { coord: [127.380001, 36.36] } }
    expect(legKey(similar)).toBe(legKey(request))
    const result = await getLegs([request, similar, request])
    expect(result).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).startX).toBe(127.38)
  })

  it('다른 서비스 인스턴스도 DB 캐시를 재사용하고 키 없이 조회할 수 있다', async () => {
    const first = await getLegs([request])
    vi.stubEnv('TMAP_APP_KEY', '')
    const another = createLegService({ cache: createLegCache(db) })
    expect(await another([request])).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await db.select().from(legCache)).toHaveLength(1)
  })

  it('24시간 미만 캐시만 사용하고 정확히 24시간·그 이후·미래 시각은 재사용하지 않는다', async () => {
    await getLegs([request])
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      for (const ageMs of [LEG_CACHE_TTL_MS - 1, LEG_CACHE_TTL_MS, LEG_CACHE_TTL_MS + 1, -1]) {
        await db.update(legCache).set({ fetchedAt: new Date(now - ageMs) }).where(eq(legCache.key, legKey(request)))
        expect((await cache.read([legKey(request)])).has(legKey(request))).toBe(ageMs >= 0 && ageMs < LEG_CACHE_TTL_MS)
      }
      expect(await db.select().from(legCache)).toHaveLength(1)
    } finally { clock.mockRestore() }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('만료한 캐시는 새 경로가 성공한 뒤에만 갱신한다', async () => {
    await getLegs([request])
    const oldTime = new Date(Date.now() - LEG_CACHE_TTL_MS - 1000)
    await db.update(legCache).set({ fetchedAt: oldTime }).where(eq(legCache.key, legKey(request)))
    fetchMock.mockResolvedValueOnce(new Response('목업 외부 실패', { status: 503 }))
    await expect(getLegs([request])).rejects.toMatchObject({ kind: 'upstream' })
    expect((await db.select().from(legCache))[0].fetchedAt.getTime()).toBe(oldTime.getTime())
    expect(await getLegs([request])).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect((await db.select().from(legCache))[0].fetchedAt.getTime()).toBeGreaterThan(oldTime.getTime())
  })

  it('이동 방향·수단·지점 ID를 기존 legKey대로 구분한다', async () => {
    const reversed: LegRequest = { from: request.to, to: request.from, mode: 'walk' }
    const nodeRequest: LegRequest = { ...request, from: { ...request.from, placeId: 'one', nodeId: 'exit' }, to: { ...request.to, placeId: 'two', nodeId: 'entrance' } }
    const routeMock = vi.fn(async (input: LegRequest) => ({ distanceM: 300, path: input.from.coord[0] === 127.38 ? route.path : [...route.path].reverse() }))
    const service = createLegService({ cache, route: routeMock })
    const result = await service([request, reversed, nodeRequest])
    expect(result.map(item => item.key)).toEqual([legKey(request), legKey(reversed), 'one/exit>two/entrance:walk'])
    expect(routeMock).toHaveBeenCalledTimes(3)
    expect(legKey({ ...request, mode: 'car' })).not.toBe(legKey(request))
  })

  it('동시에 들어온 같은 경로도 외부 호출과 캐시 저장을 공유한다', async () => {
    let complete!: (value: typeof route) => void
    const waiting = new Promise<typeof route>(resolve => { complete = resolve })
    const routeMock = vi.fn(() => waiting)
    const service = createLegService({ cache, route: routeMock })
    const first = service([request])
    const second = service([request])
    await vi.waitFor(() => expect(routeMock).toHaveBeenCalledTimes(1))
    complete(route)
    expect(await first).toEqual(await second)
    expect(routeMock).toHaveBeenCalledTimes(1)
    expect(await db.select().from(legCache)).toHaveLength(1)
  })

  it('실패한 경로는 저장하지 않으며 다음 요청은 다시 시도할 수 있다', async () => {
    const routeMock = vi.fn().mockRejectedValueOnce(new GeoError('upstream', '목업 실패')).mockResolvedValueOnce(route)
    const service = createLegService({ cache, route: routeMock })
    await expect(service([request])).rejects.toMatchObject({ kind: 'upstream' })
    expect(await db.select().from(legCache)).toEqual([])
    expect(await service([request])).toHaveLength(1)
    expect(routeMock).toHaveBeenCalledTimes(2)
  })

  it('배치 일부가 실패하면 받은 경로만 돌려주고 실패한 항목은 failed에 적으며 성공한 것만 캐시에 저장한다', async () => {
    const other: LegRequest = { from: request.to, to: request.from, mode: 'walk' }
    const service = createLegService({ cache, route: vi.fn().mockResolvedValueOnce(route).mockRejectedValueOnce(new GeoError('upstream', '목업 실패')) })
    const outcome = await service.partial([request, other])
    expect(outcome.legs.map(leg => leg.key)).toEqual([legKey(request)])
    expect(outcome.failed).toEqual([{ key: legKey(other), error: expect.objectContaining({ kind: 'upstream' }) }])
    expect((await db.select().from(legCache)).map(row => row.key)).toEqual([legKey(request)])
  })

  it('보행 1 + 버스 1 + 캐시 없음 1이 섞이면 보행 1개만 결과에 넣고 나머지는 실패로 표시한다', async () => {
    const uncached: LegRequest = { from: request.to, to: request.from, mode: 'walk' }
    const bus: LegRequest = { ...request, mode: 'bus' }
    await getLegs([request]) // 보행 1: 캐시에 저장
    vi.stubEnv('TMAP_APP_KEY', '') // 캐시 없는 보행은 TMAP을 부를 수 없다
    fetchMock.mockClear()
    const outcome = await getLegsPartial([request, bus, uncached])
    expect(outcome.legs.map(leg => leg.key)).toEqual([legKey(request)])
    expect(outcome.failed.map(item => [item.key, item.error.kind])).toEqual([[legKey(bus), 'unsupported_mode'], [legKey(uncached), 'missing_key']])
    expect(await getLegs([request, bus, uncached])).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await db.select().from(legCache)).map(row => row.key)).toEqual([legKey(request)])
  })

  it('계약 위반·계단 없음 확인·보행 시간 포함 캐시는 재사용하지 않고 정상 경로로 갱신한다', async () => {
    await getLegs([request])
    for (const change of [{ path: [] }, { stairsStatus: 'confirmed_none' as const }, { durationMin: 1 }, { source: '테스트 실험 출처' }]) {
      await db.update(legCache).set(change).where(eq(legCache.key, legKey(request)))
      const before = fetchMock.mock.calls.length
      expect((await getLegs([request]))[0].stairsStatus).toBe('unknown')
      expect(fetchMock).toHaveBeenCalledTimes(before + 1)
    }
    expect(await db.select().from(legCache)).toHaveLength(1)
  })

  it('OSM이 없는 상태에서는 TMAP 시설 코드로 계단 없음이나 칸 수를 추정하지 않는다', async () => {
    const body = structuredClone(fixture)
    Object.assign(body.features[1].properties, { facilityType: 17 })
    fetchMock.mockResolvedValueOnce(Response.json(body))
    const [leg] = await getLegs([request])
    expect(leg.stairsStatus).toBe('unknown')
    expect(leg.stairsCount).toBeUndefined()
  })

  it('requiredLegs가 대표 좌표로 만든 요청을 입구 지점으로 바꾸지 않는다', async () => {
    const place: PlaceDetail = { id: 'a', name: '가상 장소', category: 'test', styles: [], coord: request.from.coord, seated: false, indoor: false, confidence: 'C', nodes: [], segments: [] }
    const stop: Stop = { key: 'a', placeId: 'a', name: place.name, mustVisit: false, arriveBy: 'walk', skipSegmentIds: [], detourMap: {}, restNodeIds: [] }
    const requests = requiredLegs([stop, { ...stop, key: 'b', placeId: 'b' }], { a: place, b: { ...place, id: 'b', coord: request.to.coord } })
    expect(requests).toEqual([request])
    const [leg] = await getLegs(requests)
    expect(leg.key).toBe(legKey(requests[0]))
    expect(leg.key).not.toContain('entrance')
  })

  it('빈 요청과 미지원 수단만 있는 요청은 DB·키·외부 호출이 필요 없다', async () => {
    state.db = null
    expect(await getLegs([])).toEqual([])
    for (const mode of ['bus'] as const) {
      const unsupported: LegRequest = { ...request, mode }
      await expect(getLegs([unsupported])).rejects.toMatchObject({ kind: 'unsupported_mode' })
      expect(await getLegsPartial([unsupported])).toEqual({ legs: [], failed: [{ key: legKey(unsupported), error: expect.objectContaining({ kind: 'unsupported_mode' }) }] })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('하나도 못 받으면 첫 실패를 던지고, DB 저장 실패 같은 내부 오류는 항목 실패로 숨기지 않는다', async () => {
    const other: LegRequest = { from: request.to, to: request.from, mode: 'walk' }
    const failing = createLegService({ cache, route: vi.fn().mockRejectedValue(new GeoError('upstream', '목업 실패')) })
    await expect(failing([{ ...request, mode: 'bus' }, request, other])).rejects.toMatchObject({ kind: 'unsupported_mode' })
    await expect(failing([request, other])).rejects.toMatchObject({ kind: 'upstream' })
    const broken = createLegService({ cache, route: vi.fn().mockRejectedValue(new Error('내부 오류')) })
    await expect(broken.partial([request])).rejects.toThrow('내부 오류')
  })
})

describe('POST /api/legs', () => {
  it('기존 요청·응답 계약대로 동작하며 중복 요청은 한 개 결과로 반환한다', async () => {
    const response = await http({ requests: [request, request] })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(LegsResponseSchema.parse(await response.json())).toHaveLength(1)
    expect(await (await http({ requests: [] })).json()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('기존 로그인 검사를 먼저 실행하고 미로그인은 401이다', async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new HttpError(401, 'unauthorized', '로그인이 필요해요'))
    const response = await http({ requests: [request] })
    expect(response.status).toBe(401)
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('unauthorized')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await db.select().from(legCache)).toEqual([])
  })

  it.each([null, {}, { requests: 'walk' }, { requests: [null] }, { requests: [{ ...request, mode: 'fly' }] }, { requests: [{ ...request, from: { coord: [36, 127] } }] }, { requests: Array(21).fill(request) }, { requests: [], extra: true }])(
    '잘못된 입력은 400이며 외부를 호출하지 않는다: %j', async body => {
      const response = await http(body)
      expect(response.status).toBe(400)
      expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('invalid_request')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('잘못된 JSON·과도한 본문은 400, JSON이 아닌 형식은 415다', async () => {
    expect((await POST(new Request('http://localhost/api/legs', { method: 'POST', body: '{}' }))).status).toBe(415)
    for (const body of ['{', '', JSON.stringify({ requests: [], extra: 'a'.repeat(16384) })]) {
      const response = await POST(new Request('http://localhost/api/legs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
      expect(response.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('섞인 배치는 200과 받은 경로만 돌려주고, 하나도 못 받을 때만 첫 실패의 상태 코드를 쓴다', async () => {
    const uncached: LegRequest = { from: request.to, to: request.from, mode: 'walk' }
    await http({ requests: [request] })
    vi.stubEnv('TMAP_APP_KEY', '')
    fetchMock.mockClear()
    const mixed = await http({ requests: [request, { ...request, mode: 'bus' }, uncached] })
    expect(mixed.status).toBe(200)
    const legs = LegsResponseSchema.parse(await mixed.json())
    expect(legs.map(leg => leg.key)).toEqual([legKey(request)])
    expect((await http({ requests: [{ ...request, mode: 'bus' }, uncached] })).status).toBe(422)
    expect((await http({ requests: [uncached, { ...request, mode: 'bus' }] })).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bus는 캐시나 키와 상관없이 422 미지원이다', async () => {
    for (const mode of ['bus']) {
      const response = await http({ requests: [{ ...request, mode }] })
      expect(response.status).toBe(422)
      expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('invalid_request')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('키 누락 503과 외부 오류 502, 시간 초과 504를 구분하며 내부 정보를 숨긴다', async () => {
    vi.stubEnv('TMAP_APP_KEY', '')
    expect((await http({ requests: [request] })).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('TMAP_APP_KEY', 'fixture')
    fetchMock.mockResolvedValueOnce(new Response('비공개 외부 정보', { status: 429 }))
    const upstream = await http({ requests: [request] })
    expect(upstream.status).toBe(502)
    const error = ApiErrorSchema.parse(await upstream.json())
    expect(error.error.code).toBe('external_api_failed')
    expect(JSON.stringify(error)).not.toContain('비공개 외부 정보')
    // 실제 8초를 기다리지 않고 AbortController의 시간 초과 상태를 모사한다.
    fetchMock.mockImplementationOnce(async (_url, init) => {
      Object.defineProperty(init?.signal, 'aborted', { value: true })
      throw new DOMException('목업 시간 초과', 'AbortError')
    })
    expect((await http({ requests: [request] })).status).toBe(504)
    expect(await db.select().from(legCache)).toEqual([])
  })

  it('DB 읽기·저장 실패와 인증 확인 오류는 성공 대신 500을 반환한다', async () => {
    state.db = null
    const response = await http({ requests: [request] })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('비공개 DB 연결 정보')
    expect(fetchMock).not.toHaveBeenCalled()
    state.db = db
    await db.execute(sql`alter table leg_cache add constraint reject_test_write check (false)`)
    expect((await http({ requests: [request] })).status).toBe(500)
    await db.execute(sql`alter table leg_cache drop constraint reject_test_write`)
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('비공개 인증 정보'))
    const auth = await http({ requests: [request] })
    expect(auth.status).toBe(500)
    expect(JSON.stringify(await auth.json())).not.toContain('비공개 인증 정보')
  })
})
