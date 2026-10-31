// 버전 확정·확정 풀기. 담당: 김경선 (설계 10.4: 구성원 누구나 확정할 수 있다).
import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { Trip } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripVersions, trips } from '@/lib/db/schema'
import { getTrip } from './trips'

// 확정은 여행당 한 버전이다. 칸이 하나라서 다른 버전을 확정하면 이전 확정은 자동으로 풀린다.
export async function confirmVersion(
  args: { tripId: string; versionId: string; userId: string },
  db: Db = getDb(),
): Promise<Trip> {
  const [version] = await db
    .select({ id: tripVersions.id })
    .from(tripVersions)
    .where(and(eq(tripVersions.id, args.versionId), eq(tripVersions.tripId, args.tripId)))
    .limit(1)
  // 다른 여행의 버전으로 확정할 수 없다 (목업과 같은 코드·문구).
  if (!version) throw new HttpError(400, 'invalid_request', '확정할 버전을 찾을 수 없어요')

  await db
    .update(trips)
    .set({ confirmedVersionId: args.versionId, confirmedByUserId: args.userId })
    .where(eq(trips.id, args.tripId))

  // 이름(confirmedByName)을 이어 붙여 돌려주려고 다시 읽는다.
  return getTrip(args.tripId, db)
}

// 이미 풀린 상태에서 불러도 그대로 성공한다 (화면이 두 번 눌러도 오류가 나지 않게).
export async function unconfirmVersion(tripId: string, db: Db = getDb()): Promise<Trip> {
  await db
    .update(trips)
    .set({ confirmedVersionId: null, confirmedByUserId: null })
    .where(eq(trips.id, tripId))
  return getTrip(tripId, db)
}
