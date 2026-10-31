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
import { trips } from '@/lib/db/schema'

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
