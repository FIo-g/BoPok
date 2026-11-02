// 여행자 목록에서 빠진 사람의 건강 정보를 지운다. replaceTravelers(src/lib/trips/travelers.ts)가 저장 뒤에 부른다.
// health.ts와 따로 둔 까닭: health.ts는 여행자 목록을 읽으려고 trips/travelers를 import하는데,
// travelers가 health.ts를 import하면 서로를 부르는 고리가 생긴다. 이 파일은 DB 표만 쓰므로 고리가 없다.
import 'server-only'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripTravelerHealth } from '@/lib/db/schema'

// 여행자 저장이 '다 지우고 다시 넣기'라서 건강 표에는 외래키를 걸 수 없다 → 빠진 사람의 기록은 여기서 지운다.
// db.transaction()은 쓸 수 없어(Neon HTTP) 여행자 저장 뒤의 별도 문장이다. 비어 있는 목록이면 그 여행의 기록을 모두 지운다.
export async function deleteHealthExcept(
  tripId: string,
  keepTravelerIds: string[],
  db: Db = getDb(),
): Promise<void> {
  const where =
    keepTravelerIds.length === 0
      ? eq(tripTravelerHealth.tripId, tripId)
      : and(eq(tripTravelerHealth.tripId, tripId), notInArray(tripTravelerHealth.travelerId, keepTravelerIds))
  await db.delete(tripTravelerHealth).where(where)
}

// 계정 연결이 바뀐 여행자(연결·해제·다른 계정)의 건강 정보를 지운다. replaceTravelers가 저장 뒤에 부른다.
// 까닭: canSeeHealth는 연결된 계정을 먼저 보는데, 연결은 그룹 구성원 누구나 "이 사람이 저예요"로 걸 수 있고
// 서버는 그 사람이 정말 본인인지 알 수 없다. 기록을 남겨 두면 남이 연결만 걸어 "본인만" 정보를 보고,
// 동의한 사람은 지우지도(동의 철회) 못하게 된다. 동의는 그 전 사람이 한 것이므로, 새 본인이 다시 입력·동의한다.
export async function deleteHealthFor(
  tripId: string,
  travelerIds: string[],
  db: Db = getDb(),
): Promise<void> {
  if (travelerIds.length === 0) return
  await db
    .delete(tripTravelerHealth)
    .where(and(eq(tripTravelerHealth.tripId, tripId), inArray(tripTravelerHealth.travelerId, travelerIds)))
}
