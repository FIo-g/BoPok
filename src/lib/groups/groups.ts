// 그룹 만들기·내 그룹 목록·그룹 상세. 담당: 김경선 (docs/roles/account-trip.md 2단계).
// 권한 검사는 여기서 하지 않는다 — route가 src/lib/auth의 requireUser/requireMember로 먼저 막는다.
// 응답 모양은 src/lib/contracts/group.ts(화면이 쓰는 모양)를 그대로 따른다.
import 'server-only'
import { count, desc, eq, inArray } from 'drizzle-orm'
import type { Group, GroupDetail, GroupSummary } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { groupMembers, groups, user } from '@/lib/db/schema'
import { HttpError } from '@/lib/auth/http'

// 계약의 ownerId는 groups.created_by다 — 그룹을 만든 사람이 그룹장이고(설계 4.1),
// '그룹장 넘기기'는 MVP에 없으므로 둘이 항상 같다.
const groupColumns = {
  id: groups.id,
  name: groups.name,
  ownerId: groups.createdBy,
  createdAt: groups.createdAt,
}

// 그룹을 만든 사람이 그룹장(owner)이 된다.
export async function createGroup(args: { name: string; userId: string }, db: Db = getDb()): Promise<Group> {
  const [row] = await db
    .insert(groups)
    .values({ name: args.name, createdBy: args.userId })
    .returning({ id: groups.id, name: groups.name, createdAt: groups.createdAt })

  await db.insert(groupMembers).values({
    groupId: row.id,
    userId: args.userId,
    role: 'owner',
    relation: null,
  })

  return { id: row.id, name: row.name, ownerId: args.userId, createdAt: row.createdAt.toISOString() }
}

// 내가 속한 그룹만 담는다 — 남의 그룹은 애초에 결과에 들어오지 않는다 (설계 10.4).
export async function listMyGroups(userId: string, db: Db = getDb()): Promise<GroupSummary[]> {
  // ① 내가 구성원인 그룹과 이 그룹에서 '나'의 역할
  const myGroups = await db
    .select({ ...groupColumns, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId))
    .orderBy(desc(groups.createdAt))
  if (myGroups.length === 0) return []

  // ② 그 그룹들의 구성원 수. 한 쿼리로 셈한 뒤 ①과 합친다
  // (self join 대신 두 번 묻는다 — 읽기 쉽고 그룹 수가 적다).
  const counts = await db
    .select({ groupId: groupMembers.groupId, memberCount: count() })
    .from(groupMembers)
    .where(
      inArray(
        groupMembers.groupId,
        myGroups.map(group => group.id),
      ),
    )
    .groupBy(groupMembers.groupId)
  const countByGroup = new Map(counts.map(row => [row.groupId, Number(row.memberCount)]))

  return myGroups.map(group => ({
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    createdAt: group.createdAt.toISOString(),
    memberCount: countByGroup.get(group.id) ?? 1, // 내가 있으니 최소 1
    role: group.role,
  }))
}

// 그룹 + 구성원 목록. 화면은 ownerId와 내 userId를 비교해 그룹장인지 판단한다.
export async function getGroupDetail(args: { groupId: string }, db: Db = getDb()): Promise<GroupDetail> {
  const [group] = await db.select(groupColumns).from(groups).where(eq(groups.id, args.groupId)).limit(1)
  // 구성원인지 이미 확인했는데 그룹이 없다면 그 사이에 지워진 경우뿐이다.
  if (!group) throw new HttpError(404, 'not_found', '그룹을 찾을 수 없어요')

  const members = await db
    .select({
      userId: groupMembers.userId,
      name: user.name,
      role: groupMembers.role,
      relation: groupMembers.relation,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, args.groupId))
    .orderBy(groupMembers.joinedAt)

  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    createdAt: group.createdAt.toISOString(),
    members: members.map(member => ({
      userId: member.userId,
      name: member.name,
      role: member.role,
      relation: member.relation,
      joinedAt: member.joinedAt.toISOString(),
    })),
  }
}
