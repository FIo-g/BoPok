// 장소별 반응·한 줄 의견. 담당: 김경선 (설계 5장).
// getOpinions는 김태형의 src/lib/ai/deps.ts가 기다리는 모양 그대로다.
import 'server-only'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Opinion, OpinionInput } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripVersions, user, versionOpinions } from '@/lib/db/schema'

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

// POST /api/versions/:vid/opinions — 반응·한 줄 의견 남기기.
// userName은 서버가 세션에서 채운다(클라이언트가 보낸 이름을 쓰지 않는다).
export async function addOpinion(
  args: { versionId: string; userId: string; userName: string; input: OpinionInput },
  db: Db = getDb(),
): Promise<Opinion> {
  const [row] = await db
    .insert(versionOpinions)
    .values({
      versionId: args.versionId,
      stopKey: args.input.stopKey,
      userId: args.userId,
      reactions: args.input.reactions,
      comment: args.input.comment ?? null,
    })
    .returning()

  return {
    id: row.id,
    versionId: row.versionId,
    stopKey: row.stopKey,
    userId: row.userId,
    userName: args.userName,
    reactions: row.reactions,
    comment: row.comment,
    appliedInVersionId: row.appliedInVersionId,
    createdAt: row.createdAt.toISOString(),
  }
}

// DELETE /api/opinions/:oid — 권한(구성원인지 → 내 의견인지)은 access.ts의 requireOwnOpinion이 본다.
export async function removeOpinion(opinionId: string, db: Db = getDb()): Promise<void> {
  await db.delete(versionOpinions).where(eq(versionOpinions.id, opinionId))
}

// createVersion이 '이 의견들을 반영해 만든 버전'이라고 표시한다 (설계 5장).
// 그 여행의 의견이 아닌 id는 건너뛰고 서버 로그에만 남긴다 — 400으로 막으면 AI가 방금 만든
// 새 일정이 통째로 날아가는데, 잘못된 id는 곁가지 정보라서 그만한 값이 없다.
export async function markOpinionsApplied(
  args: { tripId: string; versionId: string; opinionIds: string[] },
  db: Db = getDb(),
): Promise<void> {
  if (args.opinionIds.length === 0) return

  const rows = await db
    .select({ id: versionOpinions.id })
    .from(versionOpinions)
    .innerJoin(tripVersions, eq(tripVersions.id, versionOpinions.versionId))
    .where(and(inArray(versionOpinions.id, args.opinionIds), eq(tripVersions.tripId, args.tripId)))

  const mine = rows.map(row => row.id)
  const skipped = args.opinionIds.filter(id => !mine.includes(id))
  if (skipped.length > 0) {
    console.error('[acct] 이 여행의 의견이 아닌 id는 반영 표시에서 건너뜀', { tripId: args.tripId, skipped })
  }
  if (mine.length === 0) return

  await db
    .update(versionOpinions)
    .set({ appliedInVersionId: args.versionId })
    .where(inArray(versionOpinions.id, mine))
}
