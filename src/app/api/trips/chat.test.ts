// 그룹 채팅 API 테스트. 응답은 화면이 쓰는 계약 스키마로 검사하고 '다른 그룹 사람 → 403'을 확인한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_TEXT_MAX, ChatListResponseSchema, ChatMessageSchema } from '@/lib/contracts'
import { chatMessages } from '@/lib/db/schema'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { addMember, createGroup as insertGroup, insertTrip, jsonRequestWith, readBody, routeParams, signUp } from '@/lib/auth/test-fixtures'
import { GET as listChat, POST as postChat } from './[id]/chat/route'

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

const post = (cookie: string | undefined, tripId: string, text: unknown) =>
  postChat(jsonRequestWith({ method: 'POST', cookie, body: { text }, path: '/api/trips/x/chat' }), routeParams({ id: tripId }))

function list(cookie: string | undefined, tripId: string, query = '') {
  const request = new Request(`http://localhost:3000/api/trips/x/chat${query}`, { headers: cookie ? { cookie } : {} })
  return listChat(request, routeParams({ id: tripId }))
}

async function tripFor() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  return { owner, groupId, tripId }
}

// 시각을 정해 넣어야 커서를 시험할 수 있다
async function insertAt(tripId: string, userId: string, text: string, iso: string) {
  await testDb.db.insert(chatMessages).values({ tripId, userId, text, createdAt: new Date(iso) })
}

describe('POST /api/trips/:id/chat', () => {
  it('저장한 글을 이름과 함께 돌려주고 앞뒤 공백을 자른다', async () => {
    const { owner, tripId } = await tripFor()
    const saved = ChatMessageSchema.parse(await readBody(await post(owner.cookie, tripId, '  계단이 걱정돼요  ')))
    expect(saved).toMatchObject({ tripId, userId: owner.userId, userName: '김경선', text: '계단이 걱정돼요' })
  })

  it.each([
    ['빈 글', ''],
    ['공백뿐인 글', '   '],
    ['너무 긴 글', '가'.repeat(CHAT_TEXT_MAX + 1)],
  ])('%s은 400', async (_, text) => {
    const { owner, tripId } = await tripFor()
    expect((await post(owner.cookie, tripId, text)).status).toBe(400)
  })

  it('다른 그룹 사람은 403, 로그인 안 하면 401', async () => {
    const { tripId } = await tripFor()
    const stranger = await signUp({ name: '남', email: 'other@example.com' })
    expect((await post(stranger.cookie, tripId, '안녕')).status).toBe(403)
    expect((await post(undefined, tripId, '안녕')).status).toBe(401)
  })
})

describe('GET /api/trips/:id/chat', () => {
  it('구성원은 서로의 글을 오래된 순서로 본다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member' })
    await insertAt(tripId, owner.userId, '첫 글', '2026-11-03T01:00:00.000Z')
    await insertAt(tripId, mom.userId, '둘째 글', '2026-11-03T01:00:05.000Z')

    const { messages } = ChatListResponseSchema.parse(await readBody(await list(mom.cookie, tripId)))
    expect(messages.map(one => [one.userName, one.text])).toEqual([['김경선', '첫 글'], ['엄마', '둘째 글']])
  })

  it('after는 그 시각 이후의 글만 주고 같은 시각도 포함한다', async () => {
    const { owner, tripId } = await tripFor()
    await insertAt(tripId, owner.userId, '앞', '2026-11-03T01:00:00.000Z')
    await insertAt(tripId, owner.userId, '같은 시각', '2026-11-03T01:00:05.000Z')
    await insertAt(tripId, owner.userId, '뒤', '2026-11-03T01:00:10.000Z')

    const { messages } = ChatListResponseSchema.parse(await readBody(await list(owner.cookie, tripId, '?after=2026-11-03T01:00:05.000Z')))
    expect(messages.map(one => one.text)).toEqual(['같은 시각', '뒤'])
  })

  it('방금 쓴 글의 시각을 커서로 물어도 그 글을 놓치지 않는다 (DB 시각이 더 정밀해도)', async () => {
    const { owner, tripId } = await tripFor()
    const saved = ChatMessageSchema.parse(await readBody(await post(owner.cookie, tripId, '방금 쓴 글')))

    const { messages } = ChatListResponseSchema.parse(await readBody(await list(owner.cookie, tripId, `?after=${saved.createdAt}`)))
    expect(messages.map(one => one.id)).toContain(saved.id)
  })

  it('다른 여행의 글은 보이지 않는다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const other = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
    await post(owner.cookie, other, '다른 여행 글')

    const { messages } = ChatListResponseSchema.parse(await readBody(await list(owner.cookie, tripId)))
    expect(messages).toEqual([])
  })

  it('처음 열 때는 최근 100개만 준다', async () => {
    const { owner, tripId } = await tripFor()
    await testDb.db.insert(chatMessages).values(
      Array.from({ length: 105 }, (_, index) => ({
        tripId,
        userId: owner.userId,
        text: `글 ${index}`,
        createdAt: new Date(Date.UTC(2026, 10, 3, 1, 0, index)),
      })),
    )

    const { messages } = ChatListResponseSchema.parse(await readBody(await list(owner.cookie, tripId)))
    expect(messages).toHaveLength(100)
    expect(messages[0]!.text).toBe('글 5')
    expect(messages.at(-1)!.text).toBe('글 104')
  })

  it.each(['?after=어제', '?aftr=2026-11-03T01:00:00.000Z', '?after=0000-01-01T00:00:00Z'])('잘못된 쿼리 %s는 400', async query => {
    const { owner, tripId } = await tripFor()
    expect((await list(owner.cookie, tripId, query)).status).toBe(400)
  })

  it('다른 그룹 사람은 403, 로그인 안 하면 401', async () => {
    const { tripId } = await tripFor()
    const stranger = await signUp({ name: '남', email: 'other@example.com' })
    expect((await list(stranger.cookie, tripId)).status).toBe(403)
    expect((await list(undefined, tripId)).status).toBe(401)
  })
})
