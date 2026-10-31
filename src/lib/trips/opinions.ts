// 장소별 반응·한 줄 의견 읽기. 담당: 김경선.
// 의견을 남기는 API(POST/DELETE)는 5단계다. 이 함수는 김태형의 src/lib/ai/deps.ts가
// 기다리는 getOpinions(versionId) 모양 그대로다 — 의견이 없으면 빈 배열이 정상이다.
import 'server-only'
import { asc, eq } from 'drizzle-orm'
import type { Opinion } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { user, versionOpinions } from '@/lib/db/schema'

export async function getOpinions(versionId: string, db: Db = getDb()): Promise<Opinion[]> {
  const rows = await db
    .select({ opinion: versionOpinions, userName: user.name })
    .from(versionOpinions)
    .innerJoin(user, eq(user.id, versionOpinions.userId))
    .where(eq(versionOpinions.versionId, versionId))
    .orderBy(asc(versionOpinions.createdAt))

  return rows.map(row => ({
    id: row.opinion.id,
    versionId: row.opinion.versionId,
    stopKey: row.opinion.stopKey,
    userId: row.opinion.userId,
    userName: row.userName,
    reactions: row.opinion.reactions,
    comment: row.opinion.comment,
    appliedInVersionId: row.opinion.appliedInVersionId,
    createdAt: row.opinion.createdAt.toISOString(),
  }))
}
