// AI 인터뷰의 진행 상태 저장소. 김태형의 src/lib/ai/deps.ts의 InterviewStore 모양 그대로다
// (get(tripId) → InterviewState | null, save(tripId, state) → void).
// 권한 검사는 여기서 하지 않는다 — AI API가 requireTripMember로 먼저 막는다.
import 'server-only'
import { eq } from 'drizzle-orm'
import type { InterviewState } from '@/lib/contracts'
import { InterviewStateSchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { tripInterviews } from '@/lib/db/schema'

export async function getInterview(tripId: string, db: Db = getDb()): Promise<InterviewState | null> {
  const [row] = await db
    .select({ state: tripInterviews.state })
    .from(tripInterviews)
    .where(eq(tripInterviews.tripId, tripId))
    .limit(1)
  if (!row) return null

  // jsonb는 무엇이든 담을 수 있어서 읽을 때 한 번 더 검사한다. 모양이 어긋나면(질문이 바뀐 뒤 옛 상태 등)
  // 인터뷰를 처음부터 다시 시작하게 null로 돌려주고 서버 로그에만 남긴다.
  const parsed = InterviewStateSchema.safeParse(row.state)
  if (!parsed.success) {
    console.error('[acct] 저장된 인터뷰 상태가 형식에 맞지 않아 새로 시작함', { tripId })
    return null
  }
  return parsed.data
}

// 없으면 만들고, 있으면 덮어쓴다 (여행당 한 줄).
export async function saveInterview(tripId: string, state: InterviewState, db: Db = getDb()): Promise<void> {
  const checked = InterviewStateSchema.parse(state)
  await db
    .insert(tripInterviews)
    .values({ tripId, state: checked })
    .onConflictDoUpdate({ target: tripInterviews.tripId, set: { state: checked, updatedAt: new Date() } })
}

// AiDeps['interviews']에 그대로 끼우는 묶음
export const interviews = { get: getInterview, save: saveInterview }
