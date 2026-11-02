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

// 브라우저처럼 응답의 Set-Cookie 줄을 쿠키 묶음(Cookie 헤더 모양)에 적용한다.
// 값이 비었거나 Max-Age=0·지난 Expires인 줄은 쿠키를 지운다 — 로그아웃 응답이 그렇게 쿠키를 지운다.
function applySetCookies(cookie: string, setCookieLines: string[]): string {
  const jar = new Map<string, string>()
  for (const pair of cookie.split(';')) {
    const trimmed = pair.trim()
    const eq = trimmed.indexOf('=')
    if (eq > 0) jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }

  for (const line of setCookieLines) {
    const [pair, ...attributes] = line.split(';').map(part => part.trim())
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    const expired = attributes.some(
      attr =>
        /^max-age=0$/i.test(attr) || (/^expires=/i.test(attr) && new Date(attr.slice('expires='.length)).getTime() <= Date.now()),
    )
    if (value === '' || expired) jar.delete(name)
    else jar.set(name, value)
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
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

    // 브라우저가 하는 대로, 로그아웃 응답의 Set-Cookie(지워지는 쿠키)를 적용한 뒤의 쿠키로 확인한다.
    // session_data(쿠키 캐시)도 지워지므로 DB를 보지 않고 통과하는 일은 없다.
    const response = await getAuth().handler(jsonRequest('sign-out', {}, cookie))
    expect(response.ok).toBe(true)
    const afterSignOut = applySetCookies(cookie, response.headers.getSetCookie())
    // 캐시 쿠키까지 지워졌는지 먼저 확인한다 — 남아 있으면 아래 검사가 캐시로 통과해 버린다
    expect(afterSignOut).not.toContain('better-auth.session_data=')

    await expect(requireUser(requestWith(afterSignOut))).rejects.toThrow('로그인이 필요해요')
  })

  it('[알려진 한계] 로그아웃 전에 복사해 둔 쿠키는 캐시 시간(5분) 안에서는 통한다', async () => {
    const { cookie } = await signUp({ name: '김경선', email: 'gs@example.com' })
    // 캐시 쿠키(session_data)가 같이 있어야 이 한계가 생긴다 — 가입 응답에 들어 있는지 먼저 본다
    expect(cookie).toContain('better-auth.session_token=')
    expect(cookie).toContain('better-auth.session_data=')

    const copiedBeforeSignOut = cookie
    await getAuth().handler(jsonRequest('sign-out', {}, cookie))

    // 서버 세션 행은 이미 지워졌지만 쿠키 캐시가 아직 유효해서 통과한다 (cookieCache 설정의 대가)
    await expect(requireUser(requestWith(copiedBeforeSignOut))).resolves.toBeTruthy()
  })

  it('[한계의 범위] 복사해 둔 쿠키도 캐시 시간(5분)이 지나면 막힌다', async () => {
    const { cookie } = await signUp({ name: '김경선', email: 'gs@example.com' })
    await getAuth().handler(jsonRequest('sign-out', {}, cookie))

    // Date만 가짜로 돌린다 — 타이머까지 바꾸면 PGlite·Better Auth의 비동기 처리가 멈춘다
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000)
      // 캐시가 만료되면 세션 DB를 다시 보고, 로그아웃으로 지워진 행이 없으니 막힌다
      await expect(requireUser(requestWith(cookie))).rejects.toThrow('로그인이 필요해요')
    } finally {
      vi.useRealTimers()
    }
  })

  it('[한계의 범위] 세션 토큰만 복사했다면(session_data 없음) 로그아웃 직후 바로 막힌다', async () => {
    const { cookie } = await signUp({ name: '김경선', email: 'gs@example.com' })
    const tokenOnly = cookie
      .split('; ')
      .filter(part => part.startsWith('better-auth.session_token='))
      .join('; ')
    expect(tokenOnly).toContain('better-auth.session_token=')
    expect(tokenOnly).not.toContain('better-auth.session_data=')

    await getAuth().handler(jsonRequest('sign-out', {}, cookie))

    // 캐시로는 못 통과하고, 서버 세션 행이 없으므로 바로 막힌다
    await expect(requireUser(requestWith(tokenOnly))).rejects.toThrow('로그인이 필요해요')
  })

  it('로그인 안 한 상태의 get-session은 200 + null (401이 아니다 — 401은 requireUser의 몫)', async () => {
    const response = await getAuth().handler(new Request(`${AUTH_URL}/get-session`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toBeNull()
  })
})
