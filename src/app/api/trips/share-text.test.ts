// 공유 글 API 테스트. 권한과 '확정 전이면 404'를 고정한다.
// 글 형식 자체는 src/lib/trips/share-text.test.ts에서 가짜 장소·경로로 본다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema, ShareTextResponseSchema } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  addMember,
  createGroup as insertGroup,
  insertTrip,
  jsonRequestWith,
  readBody,
  requestWith,
  routeParams,
  signUp,
  stop,
  traveler,
} from '@/lib/auth/test-fixtures'
import { replaceTravelers } from '@/lib/trips/travelers'
import { saveVersion } from '@/lib/trips/versions'
import { POST as confirmRoute } from './[id]/confirm/route'
import { GET as shareTextRoute } from './[id]/share-text/route'

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
  // 제한 시간 60초: PGlite 띄우기가 1.6초쯤 걸려 vitest 기본값으로는 모자랄 수 있다.
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

// 그룹장·엄마·여행·버전·여행자를 준비한다 (확정은 하지 않는다)
async function tripReady() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
  await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '부모님과 대전', date: '2026-11-15' })

  await replaceTravelers({
    tripId,
    travelers: [traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })],
  })
  const version = await saveVersion({
    tripId,
    userId: owner.userId,
    input: {
      parentId: null,
      stops: [
        stop({ key: 's1', name: '한밭수목원', startTime: '10:00' }),
        stop({ key: 's2', name: '점심 (도롱이마을)', startTime: '12:30', arriveBy: 'car' }),
      ],
      madeBy: 'user',
    },
  })
  return { owner, mom, groupId, tripId, version }
}

const confirmRequest = (cookie: string, versionId: string) =>
  jsonRequestWith({ method: 'POST', cookie, body: { versionId }, path: '/api/trips/x/confirm' })

describe('GET /api/trips/:id/share-text', () => {
  it('확정 전에는 404 "확정된 일정이 아직 없어요"', async () => {
    const { owner, tripId } = await tripReady()

    const response = await shareTextRoute(requestWith(owner.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(404)
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('확정된 일정이 아직 없어요')
  })

  it('확정하면 공유 글이 나온다', async () => {
    const { owner, tripId, version } = await tripReady()
    await confirmRoute(confirmRequest(owner.cookie, version.id), routeParams({ id: tripId }))

    const response = await shareTextRoute(requestWith(owner.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(200)

    const { text } = ShareTextResponseSchema.parse(await readBody(response))
    expect(text).toContain('[보폭] 부모님과 대전')
    expect(text).toContain('2026-11-15 확정 일정')
    expect(text).toContain('10:00 한밭수목원')
    expect(text).toContain('12:30 점심 (도롱이마을)')
    expect(text).toContain('출발 전 운영 여부를 꼭 확인하세요')
  })

  it('장소 데이터가 아직 없으니 숫자를 지어내지 않는다', async () => {
    const { owner, tripId, version } = await tripReady()
    await confirmRoute(confirmRequest(owner.cookie, version.id), routeParams({ id: tripId }))

    const { text } = ShareTextResponseSchema.parse(
      await readBody(await shareTextRoute(requestWith(owner.cookie), routeParams({ id: tripId }))),
    )
    expect(text).toContain('길 정보 없음')
    expect(text).toContain('하루 걷기 정보 부족')
    expect(text).not.toContain('약 0분')
    expect(text).not.toContain('계단 없음')
  })

  it('확정을 푼 뒤에는 다시 404', async () => {
    const { owner, tripId, version } = await tripReady()
    await confirmRoute(confirmRequest(owner.cookie, version.id), routeParams({ id: tripId }))
    const { DELETE } = await import('./[id]/confirm/route')
    await DELETE(jsonRequestWith({ method: 'DELETE', cookie: owner.cookie, path: '/api/trips/x/confirm' }), routeParams({ id: tripId }))

    const response = await shareTextRoute(requestWith(owner.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(404)
  })

  it('구성원이면 그룹장이 아니어도 볼 수 있다', async () => {
    const { owner, mom, tripId, version } = await tripReady()
    await confirmRoute(confirmRequest(owner.cookie, version.id), routeParams({ id: tripId }))

    const response = await shareTextRoute(requestWith(mom.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(200)
  })

  it('다른 그룹 사람은 403이고 본문에 일정이 없다', async () => {
    const { owner, tripId, version } = await tripReady()
    await confirmRoute(confirmRequest(owner.cookie, version.id), routeParams({ id: tripId }))
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await shareTextRoute(requestWith(stranger.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await readBody(response))).not.toContain('한밭수목원')
  })

  it('로그인 안 하면 401', async () => {
    const { owner, tripId, version } = await tripReady()
    await confirmRoute(confirmRequest(owner.cookie, version.id), routeParams({ id: tripId }))
    expect((await shareTextRoute(requestWith(), routeParams({ id: tripId }))).status).toBe(401)
  })
})
