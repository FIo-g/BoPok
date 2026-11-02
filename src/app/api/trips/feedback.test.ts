// 일차별 만족도 API 테스트. 응답은 화면이 쓰는 계약 스키마로 검사하고 '다른 그룹 사람 → 403'을 확인한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayFeedbackItemSchema, DayFeedbackListResponseSchema } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { addMember, createGroup as insertGroup, insertTrip, jsonRequestWith, readBody, requestWith, routeParams, signUp } from '@/lib/auth/test-fixtures'
import { GET as listFeedback, PUT as saveFeedback } from './[id]/feedback/route'

let testDb: TestDb

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

const put = (cookie: string | undefined, tripId: string, body: unknown) =>
  saveFeedback(jsonRequestWith({ method: 'PUT', cookie, body, path: '/api/trips/x/feedback' }), routeParams({ id: tripId }))

const list = (cookie: string | undefined, tripId: string) => listFeedback(requestWith(cookie), routeParams({ id: tripId }))

async function tripFor() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  return { owner, groupId, tripId }
}

describe('일차별 만족도 API', () => {
  it('남기면 이름과 함께 돌려주고 목록에 나온다', async () => {
    const { owner, tripId } = await tripFor()

    const saved = DayFeedbackItemSchema.parse(await readBody(await put(owner.cookie, tripId, { day: 2, score: 4, comment: '좋았어요' })))
    expect(saved).toMatchObject({ tripId, day: 2, score: 4, comment: '좋았어요', userId: owner.userId, userName: '김경선' })

    const body = DayFeedbackListResponseSchema.parse(await readBody(await list(owner.cookie, tripId)))
    expect(body.feedback).toHaveLength(1)
  })

  it('다시 남기면 덮어쓴다 (줄이 늘지 않고 한 줄 의견도 지워진다)', async () => {
    const { owner, tripId } = await tripFor()
    await put(owner.cookie, tripId, { day: 1, score: 2, comment: '힘들었어요' })
    await put(owner.cookie, tripId, { day: 1, score: 5 })

    const { feedback } = DayFeedbackListResponseSchema.parse(await readBody(await list(owner.cookie, tripId)))
    expect(feedback).toHaveLength(1)
    expect(feedback[0]).toMatchObject({ score: 5 })
    expect(feedback[0]!.comment ?? null).toBeNull()
  })

  it('가족은 각자 남기고 날마다 따로 남는다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member' })

    await put(owner.cookie, tripId, { day: 1, score: 3 })
    await put(mom.cookie, tripId, { day: 1, score: 4 })
    await put(mom.cookie, tripId, { day: 2, score: 5 })

    const { feedback } = DayFeedbackListResponseSchema.parse(await readBody(await list(owner.cookie, tripId)))
    expect(feedback).toHaveLength(3)
  })

  it('몸체로 보낸 다른 사람 id는 쓰지 않는다', async () => {
    const { owner, tripId } = await tripFor()
    const saved = DayFeedbackItemSchema.parse(await readBody(await put(owner.cookie, tripId, { day: 1, score: 3, userId: 'someone-else' })))
    expect(saved.userId).toBe(owner.userId)
  })

  it.each([
    ['점수 0', { day: 1, score: 0 }],
    ['점수 6', { day: 1, score: 6 }],
    ['0일차', { day: 0, score: 3 }],
    ['너무 먼 날', { day: 31, score: 3 }],
    ['101자', { day: 1, score: 3, comment: '가'.repeat(101) }],
  ])('%s은 400', async (_, body) => {
    const { owner, tripId } = await tripFor()
    expect((await put(owner.cookie, tripId, body)).status).toBe(400)
  })

  it('다른 그룹 사람은 403, 로그인 안 하면 401', async () => {
    const { tripId } = await tripFor()
    const stranger = await signUp({ name: '남', email: 'other@example.com' })

    expect((await list(stranger.cookie, tripId)).status).toBe(403)
    expect((await put(stranger.cookie, tripId, { day: 1, score: 3 })).status).toBe(403)
    expect((await list(undefined, tripId)).status).toBe(401)
  })
})
