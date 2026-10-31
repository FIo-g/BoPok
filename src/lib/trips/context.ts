// AI(김태형)가 인터뷰·다시 짜기에서 부르는 여행 정보. src/lib/ai/deps.ts의 모양 그대로다.
// 다른 파트가 내 테이블을 직접 읽지 않게 하는 창구 (AGENTS.md 4장).
import 'server-only'
import { eq } from 'drizzle-orm'
import type { StartMode, Traveler, TripVersion } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { trips } from '@/lib/db/schema'
import { listTravelers } from './travelers'
import { listVersions } from './versions'

// deps.ts의 AiTripInfo·TripContext와 같은 모양 (타입을 import하지 않고 구조만 맞춘다 —
// lib/ai는 김태형 담당이라 그쪽을 기준으로 끌어오면 서로 물고 들어간다).
export type TripInfo = { id: string; groupId: string; startMode: StartMode }
export type TripContext = { trip: TripInfo; travelers: Traveler[]; versions: TripVersion[] }

export async function getTripContext(tripId: string, db: Db = getDb()): Promise<TripContext> {
  const [row] = await db
    .select({ id: trips.id, groupId: trips.groupId, startMode: trips.startMode })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1)
  if (!row) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')

  // AI는 이전 일정을 봐야 다시 짤 수 있으므로 stops까지 담는다 (요약이 아니다).
  return { trip: row, travelers: await listTravelers(tripId, db), versions: await listVersions(tripId, db) }
}
