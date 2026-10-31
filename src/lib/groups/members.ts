// 구성원 내보내기. 담당: 김경선.
// 이름이 비슷한 src/lib/auth/members.ts는 '권한 검사를 위한 구성원 조회'(findMembership)다.
// 이 파일은 '내보내기'와 그에 딸린 그룹장 보호 규칙이다.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { RemoveMemberResponse } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { groupMembers } from '@/lib/db/schema'
import { findMembership } from '@/lib/auth/members'
import { HttpError } from '@/lib/auth/http'

// 그룹장만 부른다 (route에서 requireOwner).
// 막는 규칙 두 겹 (역할 문서 2단계 결정):
//  ① 그룹장이 자기 자신을 내보내는 것 — 그룹을 지우는 기능이 없어 그룹이 주인 없이 남는다
//  ② 내보낸 뒤 그룹장이 0명이 되는 것 — 지금은 그룹장이 한 명뿐이라 ①과 같은 상황이지만,
//     나중에 '그룹장 넘기기'가 생겨 그룹장이 둘이 되어도 안전하게 지금 넣어 둔다
export async function removeMember(
  args: { groupId: string; targetUserId: string; actorUserId: string },
  db: Db = getDb(),
): Promise<RemoveMemberResponse> {
  if (args.targetUserId === args.actorUserId) {
    throw new HttpError(400, 'invalid_request', '그룹장은 자신을 내보낼 수 없어요')
  }

  const target = await findMembership(args.groupId, args.targetUserId, db)
  if (!target) throw new HttpError(404, 'not_found', '그 구성원을 찾을 수 없어요')

  if (target.role === 'owner') {
    const owners = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, args.groupId), eq(groupMembers.role, 'owner')))
    if (owners.length <= 1) {
      throw new HttpError(400, 'invalid_request', '그룹장이 없는 그룹이 될 수 없어요')
    }
  }

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, args.groupId), eq(groupMembers.userId, args.targetUserId)))

  return { removed: true }
}
