// 다른 역할이 쓰는 창구. 안쪽 파일(auth.ts·session.ts·members.ts)은 몰라도 된다.
// 담당: 김경선 (docs/roles/account-trip.md)
export { getAuth } from './auth'
export { HttpError, errorResponse, handle } from './http'
export { getSessionUser, requireUser, requireMember, requireOwner } from './session'
export type { SessionUser, MemberUser } from './session'
export type { GroupRole, Membership } from './members'
