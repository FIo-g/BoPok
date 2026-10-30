// 권한 검사. 모든 API는 일을 하기 전에 이 함수들을 먼저 부른다.
// Neon에는 행 단위 보안이 기본으로 없으므로 서버 코드가 유일한 방어선이다 (설계 10.4).
import 'server-only'
import { getAuth } from './auth'
import { HttpError } from './http'
import type { GroupRole } from './members'
import { findMembership } from './members'

export type SessionUser = {
  userId: string
  userName: string
}

export type MemberUser = SessionUser & {
  role: GroupRole
  relation: string | null
}

// 로그인했으면 누구인지, 아니면 null. '로그인 안 한 상태'는 오류가 아니라 정상 답이다
// (Better Auth의 /api/auth/get-session도 200 + null을 준다).
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) return null
  return { userId: session.user.id, userName: session.user.name }
}

// 로그인 필수. 안 했으면 401.
export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(request)
  if (!user) throw new HttpError(401, 'unauthorized', '로그인이 필요해요')
  return user
}

// 그룹 구성원 필수. 아니면 403. 그룹이 아예 없을 때도 403으로 똑같이 답한다 —
// 404로 나누면 '그 그룹이 있긴 하다'는 사실이 남의 눈에 새기 때문이다.
export async function requireMember(request: Request, groupId: string): Promise<MemberUser> {
  const user = await requireUser(request)
  const membership = await findMembership(groupId, user.userId)
  if (!membership) throw new HttpError(403, 'forbidden', '이 그룹의 구성원이 아니에요')
  return { ...user, role: membership.role, relation: membership.relation }
}

// 그룹장 필수. 초대 링크 만들기·구성원 내보내기에만 쓴다 (설계 10.4).
export async function requireOwner(request: Request, groupId: string): Promise<MemberUser> {
  const member = await requireMember(request, groupId)
  if (member.role !== 'owner') throw new HttpError(403, 'forbidden', '그룹장만 할 수 있어요')
  return member
}
