// 날씨 API 테스트: 그룹 구성원만 보고, 테스트에서는 기상청을 실제로 부르지 않는다 (AGENTS 5장).
// 기상청 응답 읽기·발표 시각·캐시는 src/lib/weather 테스트가 본다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripWeatherResponseSchema } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { addMember, createGroup as insertGroup, insertTrip, readBody, requestWith, routeParams, signUp } from '@/lib/auth/test-fixtures'
import { clearWeatherCache } from '@/lib/weather'
import { GET as getWeather } from './[id]/weather/route'

let testDb: TestDb

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  // 키가 없으면 기상청을 부르지 않는다 — 이 테스트가 바깥으로 나가지 않게 한다
  vi.stubEnv('TOURAPI_SERVICE_KEY', '')
  testDb = await setupTestDb()
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
  clearWeatherCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

async function setup(date?: string) {
  const owner = await signUp({ name: '김태형', email: 'owner@example.com' })
  const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
  const stranger = await signUp({ name: '남', email: 'stranger@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, ...(date ? { date } : {}) })
  return { owner, mom, stranger, tripId }
}

const get = (cookie: string | undefined, tripId: string) => getWeather(requestWith(cookie), routeParams({ id: tripId }))

describe('GET /api/trips/:id/weather', () => {
  it('로그인 안 하면 401, 다른 그룹 사람은 403', async () => {
    const { stranger, tripId } = await setup('2099-01-01')
    expect((await get(undefined, tripId)).status).toBe(401)
    expect((await get(stranger.cookie, tripId)).status).toBe(403)
  })

  it('여행 날짜가 없으면 빈 목록', async () => {
    const { mom, tripId } = await setup()
    const response = await get(mom.cookie, tripId)
    expect(response.status).toBe(200)
    expect(TripWeatherResponseSchema.parse(await readBody(response)).days).toEqual([])
  })

  it('아직 예보가 없는 먼 날은 too_far이고 기상청을 부르지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { owner, tripId } = await setup('2099-01-01')
    const response = await get(owner.cookie, tripId)
    expect(response.status).toBe(200)
    const body = TripWeatherResponseSchema.parse(await readBody(response))
    expect(body.days).toEqual([{ day: 1, date: '2099-01-01', status: 'too_far', forecast: null }])
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('apis.data.go.kr'))).toBe(false)
  })
})
