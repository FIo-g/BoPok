// 여행자 정보가 바뀌면 그 여행의 모든 버전 요약이 낡는다 — 다시 계산해 덮어쓴다
// (역할 문서 '버전 저장 시 판정 요약'). 목업의 refreshSummaries와 같은 동작이다.
//
// 여행자 목록을 인자로 받는 이유: 방금 저장한 목록을 그대로 넘기면 travelers.ts와
// 서로 import하는 고리가 생기지 않는다.
import 'server-only'
import { asc, eq } from 'drizzle-orm'
import type { Traveler } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripVersions } from '@/lib/db/schema'
import { safeSummary } from './judge-run'

// 이 함수는 던지지 않는다 — 요약을 못 고쳐도 여행자 저장은 이미 끝났고 성공이어야 한다.
// 버전마다 판정을 다시 돌리므로 버전이 많으면 그만큼 조회가 반복된다. MVP 규모(여행당 몇 개)에서는
// 괜찮고 경로는 leg_cache가 받쳐 준다. 느려지면 장소 상세를 한 번만 받아 나눠 쓰도록 고친다.
export async function refreshSummaries(
  args: { tripId: string; travelers: Traveler[] },
  db: Db = getDb(),
): Promise<void> {
  try {
    const versions = await db
      .select({ id: tripVersions.id, stops: tripVersions.stops })
      .from(tripVersions)
      .where(eq(tripVersions.tripId, args.tripId))
      .orderBy(asc(tripVersions.number))

    for (const version of versions) {
      const summary = await safeSummary({ stops: version.stops, travelers: args.travelers })
      await db.update(tripVersions).set({ judgeSummary: summary }).where(eq(tripVersions.id, version.id))
    }
  } catch (error) {
    console.error('[acct] 버전 요약을 다시 계산하지 못했어요', error instanceof Error ? error.message : error)
  }
}
