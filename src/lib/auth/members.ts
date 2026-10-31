// 그룹 구성원인지 DB에서 확인한다. 권한 검사(session.ts)의 재료.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { GroupRole } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { groupMembers } from '@/lib/db/schema'

// GroupRole('owner'|'member')의 원본은 src/lib/contracts/group.ts다 (AGENTS.md 4장: 경계는 contracts).
// 여기서 다시 정의하면 한쪽만 고쳤을 때 조용히 어긋난다.
export type Membership = {
  groupId: string
  userId: string
  role: GroupRole
  relation: string | null // 엄마·아들처럼 가족 안에서의 관계. 안 적었으면 null
}

// db를 인자로 받는 이유: 테스트에서 메모리 DB를 넣어 가짜 함수 없이 진짜 SQL로 검사한다.
// 평소에는 안 넘기면 getDb()를 쓴다.
export async function findMembership(groupId: string, userId: string, db: Db = getDb()): Promise<Membership | null> {
  const rows = await db
    .select({
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      role: groupMembers.role,
      relation: groupMembers.relation,
    })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)
  return rows[0] ?? null
}
