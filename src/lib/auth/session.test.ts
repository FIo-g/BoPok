// 권한 검사 테스트. "남의 그룹 데이터가 보이면 가장 심각한 버그"(역할 문서)라서
// 구성원 아님 → 403을 반드시 확인한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { HttpError } from './http'
import { findMembership } from './members'
import { requireMember, requireOwner, requireUser } from './session'
import { addMember, createGroup, requestWith, signUp } from './test-fixtures'

let testDb: TestDb

// PGlite를 띄우는 데 1.6초가 걸리므로 파일당 한 번만 띄우고,
// 테스트 사이에는 테이블만 비운다.
beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 하므로
  // 필요한 환경 변수를 테스트 안에서 가짜로 넣는다.
  vi.stubEnv('DATABASE_URL', '') // 비우면 Neon이 아니라 PGlite
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
  // 제한 시간 60초: 메모리 PGlite를 띄우는 데 1.6초쯤 걸리는데, 느린 컴퓨터나 CI에서는
  // vitest 기본값 5초를 넘겨 '초기화 시간 초과'로 실패한다 (이동주 제보).
  // vitest.config.ts는 공용 파일이라 건드리지 않고 이 파일에서만 늘린다.
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

// 오류가 나야 하는 경우를 읽기 쉽게 적기 위한 도우미
async function catchHttpError(run: () => Promise<unknown>): Promise<HttpError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof HttpError) return error
    throw error
  }
  throw new Error('HttpError가 나야 하는데 그냥 통과했다')
}

describe('requireUser', () => {
  it('로그인 안 한 요청은 401', async () => {
    const error = await catchHttpError(() => requireUser(requestWith()))
    expect(error.status).toBe(401)
    expect(error.code).toBe('unauthorized')
  })

  it('엉뚱한 쿠키도 401 (서버가 쿠키를 믿지 않는다)', async () => {
    const error = await catchHttpError(() => requireUser(requestWith('better-auth.session_token=made-up-value')))
    expect(error.status).toBe(401)
  })

  it('로그인한 요청은 누구인지 돌려준다', async () => {
    const { userId, cookie } = await signUp({ name: '김경선', email: 'gs@example.com' })
    await expect(requireUser(requestWith(cookie))).resolves.toEqual({ userId, userName: '김경선' })
  })
})

describe('requireMember', () => {
  it('구성원이면 통과하고 역할·관계를 알려준다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    await expect(requireMember(requestWith(mom.cookie), groupId)).resolves.toEqual({
      userId: mom.userId,
      userName: '엄마',
      role: 'member',
      relation: '엄마',
    })
  })

  it('다른 그룹 사람은 403 — 남의 가족 여행이 보이면 안 된다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const error = await catchHttpError(() => requireMember(requestWith(stranger.cookie), groupId))
    expect(error.status).toBe(403)
    expect(error.code).toBe('forbidden')
  })

  it('없는 그룹도 403 (404로 나누면 그룹이 있다는 사실이 새어 나간다)', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })
    const error = await catchHttpError(() => requireMember(requestWith(me.cookie), 'no-such-group'))
    expect(error.status).toBe(403)
  })

  it('로그인부터 안 했으면 403이 아니라 401', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    const error = await catchHttpError(() => requireMember(requestWith(), groupId))
    expect(error.status).toBe(401)
  })
})

describe('requireOwner', () => {
  it('그룹장은 통과', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    const result = await requireOwner(requestWith(owner.cookie), groupId)
    expect(result.role).toBe('owner')
  })

  it('그냥 구성원은 403 (초대 링크 만들기·내보내기는 그룹장만)', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    const error = await catchHttpError(() => requireOwner(requestWith(son.cookie), groupId))
    expect(error.status).toBe(403)
  })
})

describe('findMembership', () => {
  it('구성원이 아니면 null', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await expect(findMembership(groupId, 'other-user', testDb.db)).resolves.toBeNull()
  })

  it('관계를 안 적으면 null로 들어간다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    const membership = await findMembership(groupId, owner.userId, testDb.db)
    expect(membership).toEqual({ groupId, userId: owner.userId, role: 'owner', relation: null })
  })
})
