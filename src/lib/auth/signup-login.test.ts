// 1단계 완료 기준("가입 → 로그인 → 세션 확인")을 테스트로 고정한다.
// 진짜 Better Auth와 진짜 DB(메모리 PGlite)를 쓴다 — 가짜 함수 없음. 외부 API는 부르지 않는다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { account, session, user } from '@/lib/db/schema'
import { getAuth } from './auth'
import { requireUser } from './session'
import { TEST_PASSWORD, requestWith, signIn, signUp } from './test-fixtures'

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

const AUTH_URL = 'http://localhost:3000/api/auth'

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${AUTH_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

describe('가입', () => {
  it('user 행이 생기고 이름·이메일이 그대로 들어간다', async () => {
    const { userId } = await signUp({ name: '김경선', email: 'gs@example.com' })

    const rows = await testDb.db.select().from(user).where(eq(user.id, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('김경선')
    expect(rows[0].email).toBe('gs@example.com')
    // 이메일 인증은 MVP에서 쓰지 않는다 (설계 2.2)
    expect(rows[0].emailVerified).toBe(false)
  })

  it('비밀번호는 account에 해시로 저장된다 (평문 금지)', async () => {
    const { userId } = await signUp({ name: '김경선', email: 'gs@example.com' })

    const rows = await testDb.db.select().from(account).where(eq(account.userId, userId))
    expect(rows).toHaveLength(1)
    expect(rows[0].providerId).toBe('credential')
    expect(rows[0].password).not.toBeNull()
    expect(rows[0].password).not.toContain(TEST_PASSWORD)
    expect(rows[0].password!.length).toBeGreaterThan(50)
  })

  it('같은 이메일로 두 번 가입할 수 없다', async () => {
    await signUp({ name: '김경선', email: 'gs@example.com' })
    await expect(signUp({ name: '다른 사람', email: 'gs@example.com' })).rejects.toThrow(/가입 실패/)
  })
})

describe('로그인 → 세션 확인', () => {
  it('로그인하면 session 행이 생기고, 그 쿠키로 requireUser가 통과한다', async () => {
    const { userId } = await signUp({ name: '김경선', email: 'gs@example.com' })
    const cookie = await signIn('gs@example.com')

    const sessions = await testDb.db.select().from(session).where(eq(session.userId, userId))
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    // 만료는 미래여야 한다
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now())

    await expect(requireUser(requestWith(cookie))).resolves.toEqual({ userId, userName: '김경선' })
  })

  it('틀린 비밀번호는 401', async () => {
    await signUp({ name: '김경선', email: 'gs@example.com' })

    const response = await getAuth().handler(
      jsonRequest('sign-in/email', { email: 'gs@example.com', password: 'wrong-password-1234' }),
    )
    expect(response.status).toBe(401)
  })

  it('로그아웃하면 그 쿠키는 더 이상 통하지 않는다', async () => {
    const { cookie } = await signUp({ name: '김경선', email: 'gs@example.com' })
    await expect(requireUser(requestWith(cookie))).resolves.toBeTruthy()

    const response = await getAuth().handler(jsonRequest('sign-out', {}, cookie))
    expect(response.ok).toBe(true)

    await expect(requireUser(requestWith(cookie))).rejects.toThrow('로그인이 필요해요')
  })

  it('로그인 안 한 상태의 get-session은 200 + null (401이 아니다 — 401은 requireUser의 몫)', async () => {
    const response = await getAuth().handler(new Request(`${AUTH_URL}/get-session`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toBeNull()
  })
})
