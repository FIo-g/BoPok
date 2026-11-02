// Better Auth 본체. 이메일·비밀번호 + 이름만 쓴다 (비밀번호 찾기·이메일 인증·소셜 로그인은 MVP 범위 밖 —
// docs/roles/account-trip.md). 테이블은 src/lib/db/schema/auth.ts.
import 'server-only'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { getDb } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'

function createAuth() {
  return betterAuth({
    // transaction은 기본값이 false다. 배포에서 쓰는 Neon HTTP 드라이버가 트랜잭션을 지원하지 않으므로
    // (AGENTS.md 8장) 기본값에 기대지 않고 적어 둔다.
    database: drizzleAdapter(getDb(), { provider: 'pg', schema, transaction: false }),
    emailAndPassword: { enabled: true },
    // 로그인 확인을 쿠키에 담아 요청마다 세션 DB를 보지 않게 한다 (배포 DB 왕복 절약, 11/2 결정).
    // 대가: 세션 변경이 다른 기기·복사해 둔 쿠키에는 최대 5분 늦게 닿는다(로그아웃된 세션이 통하고,
    // 이름·비밀번호 바꾸기, 다른 세션 끊기도 그동안 예전 값 — docs/roles/account-trip.md '로그인').
    // 로그아웃한 브라우저는 쿠키가 지워지고, 그룹 내보내기는 매 요청 group_members를 보므로 바로 막힌다.
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // 서버 액션에서 로그인해도 쿠키가 심기게 한다. 플러그인 목록의 맨 끝이어야 한다.
    plugins: [nextCookies()],
  })
}

type Auth = ReturnType<typeof createAuth>

// 개발 서버가 코드를 다시 불러와도(HMR) 같은 인스턴스를 쓴다 — src/lib/db/client.ts와 같은 방식.
const store = globalThis as typeof globalThis & { __bopokAuth?: Auth }

// 처음 부를 때 만든다. import 시점에 만들면 빌드할 때 DB를 열게 된다.
export function getAuth(): Auth {
  if (store.__bopokAuth) return store.__bopokAuth
  store.__bopokAuth = createAuth()
  return store.__bopokAuth
}
