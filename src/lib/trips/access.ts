// 여행 API의 권한 검사. 모든 여행 API가 일을 하기 전에 이것부터 부른다.
// 여행에는 group_id가 있으니 그 그룹의 구성원인지를 본다 (설계 10.4).
import 'server-only'
import { eq } from 'drizzle-orm'
import { findMembership } from '@/lib/auth/members'
import { HttpError } from '@/lib/auth/http'
import type { MemberUser } from '@/lib/auth/session'
import { requireUser } from '@/lib/auth/session'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripVersions, trips, versionOpinions } from '@/lib/db/schema'

export type TripMember = MemberUser & { groupId: string }

// 김태형의 src/lib/ai/deps.ts가 기다리는 requireTripMember(request, tripId)와 같은 모양이다
// (돌려주는 값이 SessionUser보다 많지만 그대로 끼워진다).
export async function requireTripMember(request: Request, tripId: string, db: Db = getDb()): Promise<TripMember> {
  // 로그인부터 본다 — 여행이 없을 때도 401과 403을 구분해 주기 위해서.
  const me = await requireUser(request)

  const [trip] = await db.select({ groupId: trips.groupId }).from(trips).where(eq(trips.id, tripId)).limit(1)
  // 없는 여행도 403으로 답한다 — 404로 나누면 '그 여행이 있긴 하다'가 새어 나간다 (2단계와 같은 규칙).
  if (!trip) throw new HttpError(403, 'forbidden', '이 여행에 접근할 수 없어요')

  const membership = await findMembership(trip.groupId, me.userId, db)
  if (!membership) throw new HttpError(403, 'forbidden', '이 여행에 접근할 수 없어요')

  return { ...me, role: membership.role, relation: membership.relation, groupId: trip.groupId }
}

export type VersionMember = TripMember & { versionId: string }

// 의견 API는 주소에 버전 id만 있다 → 버전 → 여행 → 그룹을 따라가 구성원인지 본다.
// 버전이 없으면 404(목업과 같은 문구). 남의 그룹 버전이면 403이다.
export async function requireVersionMember(
  request: Request,
  versionId: string,
  db: Db = getDb(),
): Promise<VersionMember> {
  const me = await requireUser(request)

  const [row] = await db
    .select({ tripId: tripVersions.tripId, groupId: trips.groupId })
    .from(tripVersions)
    .innerJoin(trips, eq(trips.id, tripVersions.tripId))
    .where(eq(tripVersions.id, versionId))
    .limit(1)
  if (!row) throw new HttpError(404, 'not_found', '버전을 찾을 수 없어요')

  const membership = await findMembership(row.groupId, me.userId, db)
  if (!membership) throw new HttpError(403, 'forbidden', '이 여행에 접근할 수 없어요')

  return { ...me, role: membership.role, relation: membership.relation, groupId: row.groupId, versionId }
}

export type OpinionOwner = {
  me: TripMember
  opinion: { id: string; versionId: string; userId: string }
}

// 의견 지우기용. 순서가 중요하다:
//  ① 지금도 그 그룹 구성원인지  ② 그다음 내 의견인지
// 그룹에서 내보내진 사람은 예전에 남긴 자기 의견도 지울 수 없다 (그 그룹 데이터에서 손을 뗀 것).
export async function requireOwnOpinion(
  request: Request,
  opinionId: string,
  db: Db = getDb(),
): Promise<OpinionOwner> {
  const me = await requireUser(request)

  const [row] = await db
    .select({
      id: versionOpinions.id,
      versionId: versionOpinions.versionId,
      userId: versionOpinions.userId,
      groupId: trips.groupId,
    })
    .from(versionOpinions)
    .innerJoin(tripVersions, eq(tripVersions.id, versionOpinions.versionId))
    .innerJoin(trips, eq(trips.id, tripVersions.tripId))
    .where(eq(versionOpinions.id, opinionId))
    .limit(1)
  if (!row) throw new HttpError(404, 'not_found', '의견을 찾을 수 없어요')

  const membership = await findMembership(row.groupId, me.userId, db)
  if (!membership) throw new HttpError(403, 'forbidden', '이 여행에 접근할 수 없어요')

  if (row.userId !== me.userId) throw new HttpError(403, 'forbidden', '내 의견만 지울 수 있어요')

  return {
    me: { ...me, role: membership.role, relation: membership.relation, groupId: row.groupId },
    opinion: { id: row.id, versionId: row.versionId, userId: row.userId },
  }
}
