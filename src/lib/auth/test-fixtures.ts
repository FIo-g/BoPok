// 테스트에서만 쓰는 보조 함수. 가입해서 로그인 쿠키를 얻고, 그룹·구성원을 넣는다.
// `.test.ts`가 아니라 여기 둔 이유: 여러 테스트 파일이 같이 쓴다.
import 'server-only'
import type { GroupRole } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { groupMembers, groups, user } from '@/lib/db/schema'
import { getAuth } from './auth'

const BASE_URL = 'http://localhost:3000'
export const TEST_PASSWORD = 'bopok-test-1234' // 테스트용. Better Auth 기본 최소 길이(8자)보다 길다

// 실제 route.ts와 같은 길로 가입한다 — getAuth().handler(Request)를 그대로 쓴다.
// 돌려주는 cookie는 다음 요청의 Cookie 헤더에 그대로 넣으면 된다.
export async function signUp(args: { name: string; email: string }): Promise<{ userId: string; cookie: string }> {
  const response = await getAuth().handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: args.name, email: args.email, password: TEST_PASSWORD }),
    }),
  )
  if (!response.ok) throw new Error(`가입 실패 (${response.status}): ${await response.text()}`)
  const body = (await response.json()) as { user: { id: string } }
  return { userId: body.user.id, cookie: cookieFrom(response) }
}

// Set-Cookie 여러 줄 가운데 이름=값 부분만 모아 Cookie 헤더 모양으로 만든다.
function cookieFrom(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .map(line => line.split(';')[0])
    .join('; ')
  if (!cookie) throw new Error('응답에 Set-Cookie가 없다')
  return cookie
}

export async function signIn(email: string): Promise<string> {
  const response = await getAuth().handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    }),
  )
  if (!response.ok) throw new Error(`로그인 실패 (${response.status}): ${await response.text()}`)
  return cookieFrom(response)
}

// 권한 함수에 넣을 요청. cookie가 없으면 로그인 안 한 요청이 된다.
export function requestWith(cookie?: string): Request {
  return new Request(`${BASE_URL}/api/groups`, {
    headers: cookie ? { cookie } : {},
  })
}

// 그룹을 만들고 만든 사람을 owner로 넣는다 (2단계 POST /api/groups가 할 일을 테스트에서 미리).
export async function createGroup(db: Db, args: { name: string; ownerId: string }): Promise<string> {
  const [row] = await db.insert(groups).values({ name: args.name, createdBy: args.ownerId }).returning({ id: groups.id })
  await addMember(db, { groupId: row.id, userId: args.ownerId, role: 'owner' })
  return row.id
}

export async function addMember(
  db: Db,
  args: { groupId: string; userId: string; role: GroupRole; relation?: string },
): Promise<void> {
  await db.insert(groupMembers).values({
    groupId: args.groupId,
    userId: args.userId,
    role: args.role,
    relation: args.relation ?? null,
  })
}

// 계정 없이 user 행만 필요할 때 (비밀번호·세션 없이 id만 쓰는 경우)
export async function insertUser(db: Db, args: { id: string; name: string; email: string }): Promise<void> {
  await db.insert(user).values({ id: args.id, name: args.name, email: args.email })
}
