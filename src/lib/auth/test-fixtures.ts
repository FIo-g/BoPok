// 테스트에서만 쓰는 보조 함수. 가입해서 로그인 쿠키를 얻고, 그룹·구성원을 넣는다.
// `.test.ts`가 아니라 여기 둔 이유: 여러 테스트 파일이 같이 쓴다.
import 'server-only'
import type { GroupRole, Reaction, Stop, Traveler } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { groupInvites, groupMembers, groups, trips, user, versionOpinions } from '@/lib/db/schema'
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

// 몸체가 있는 요청 (POST·DELETE 등). body를 안 주면 몸체 없이 보낸다.
export function jsonRequestWith(
  args: { method: string; cookie?: string; body?: unknown; path?: string },
): Request {
  return new Request(`${BASE_URL}${args.path ?? '/api/groups'}`, {
    method: args.method,
    headers: {
      'Content-Type': 'application/json',
      ...(args.cookie ? { cookie: args.cookie } : {}),
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  })
}

// route 함수의 두 번째 인자. Next.js 16은 주소 안의 값을 Promise로 준다.
export function routeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

// 응답 본문을 읽는다. 테스트에서 상태 코드와 내용을 같이 보기 쉽게.
export async function readBody<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T
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

// 만료된 초대를 직접 넣는다 — 시계를 조작하지 않고 만료 동작(410)을 검사하려고.
export async function insertExpiredInvite(
  db: Db,
  args: { groupId: string; createdBy: string; token?: string },
): Promise<string> {
  const token = args.token ?? 'expired-token-for-test'
  await db.insert(groupInvites).values({
    groupId: args.groupId,
    token,
    createdBy: args.createdBy,
    expiresAt: new Date(Date.now() - 60 * 1000), // 1분 전에 만료됨
  })
  return token
}

// 여행과 여행자 — 3단계 테스트용. API를 거치지 않고 DB에 바로 넣는다.
export async function insertTrip(
  db: Db,
  args: { groupId: string; createdBy: string; title?: string; date?: string; mode?: 'paste' | 'scratch' },
): Promise<string> {
  const [row] = await db
    .insert(trips)
    .values({
      groupId: args.groupId,
      title: args.title ?? '대전 여행',
      date: args.date ?? null,
      startMode: args.mode ?? 'scratch',
      createdBy: args.createdBy,
    })
    .returning({ id: trips.id })
  return row.id
}

// 테스트에서 쓰는 여행자 한 명. 넘긴 칸만 바꾼다.
export function traveler(args: Partial<Traveler> & { id: string; label: string }): Traveler {
  return {
    pace: 'unknown',
    mobilityAid: false,
    isParent: false,
    condition: {},
    filledBySelf: false,
    ...args,
  }
}

// 일정 한 장소. 넘긴 칸만 바꾼다 (4단계 버전 테스트용).
export function stop(args: Partial<Stop> & { key: string; name: string }): Stop {
  return {
    placeId: null,
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...args,
  }
}

// 의견 한 줄을 DB에 바로 넣는다 — 의견 API는 5단계라서 getOpinions를 검사하려면 직접 넣어야 한다.
export async function insertOpinion(
  db: Db,
  args: { versionId: string; userId: string; stopKey?: string | null; reactions?: Reaction[]; comment?: string },
): Promise<string> {
  const [row] = await db
    .insert(versionOpinions)
    .values({
      versionId: args.versionId,
      userId: args.userId,
      stopKey: args.stopKey ?? null,
      reactions: args.reactions ?? [],
      comment: args.comment ?? null,
    })
    .returning({ id: versionOpinions.id })
  return row.id
}
