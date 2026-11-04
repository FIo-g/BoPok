// 일차별 만족도. 담당: 김경선 (설계 2026-11-02 4.3).
// 권한 검사는 여기서 하지 않는다 — route가 requireTripMember로 먼저 막는다.
import 'server-only'
import { asc, eq } from 'drizzle-orm'
import type { DayFeedbackInput, DayFeedbackItem, DayFeedbackListResponse } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { dayFeedbacks, user } from '@/lib/db/schema'
import { tripDayList } from '@/lib/plan/trip-days'
import { getTrip, getTripDetail } from './trips'

type Row = typeof dayFeedbacks.$inferSelect

function toItem(row: Row, userName: string): DayFeedbackItem {
  return {
    tripId: row.tripId,
    day: row.day,
    userId: row.userId,
    userName,
    score: row.score,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listDayFeedback(tripId: string, db: Db = getDb()): Promise<DayFeedbackListResponse> {
  const [trip, rows] = await Promise.all([
    getTrip(tripId, db),
    db
      .select({ feedback: dayFeedbacks, userName: user.name })
      .from(dayFeedbacks)
      .innerJoin(user, eq(user.id, dayFeedbacks.userId))
      .where(eq(dayFeedbacks.tripId, tripId))
      .orderBy(asc(dayFeedbacks.day), asc(dayFeedbacks.createdAt)),
  ])
  return { tripDate: trip.date ?? null, feedback: rows.map(row => toItem(row.feedback, row.userName)) }
}

// 한 사람이 그날에 하나만 남긴다. 다시 보내면 덮어쓴다 — 점수를 고쳐도 줄이 늘지 않게.
// 이름은 세션에서 받는다. 클라이언트가 보낸 이름을 쓰지 않는다.
export async function saveDayFeedback(
  args: { tripId: string; userId: string; userName: string; input: DayFeedbackInput },
  db: Db = getDb(),
): Promise<DayFeedbackItem> {
  const { day, score, comment } = args.input
  // 여행 기간과 지금 일정에 있는 날만 받는다 (날짜 탭과 같은 기준)
  const { trip, initialVersion } = await getTripDetail(args.tripId, db)
  if (!tripDayList(trip, initialVersion?.stops ?? []).includes(day)) {
    throw new HttpError(400, 'invalid_request', '없는 날이에요')
  }

  const [row] = await db
    .insert(dayFeedbacks)
    .values({ tripId: args.tripId, day, userId: args.userId, score, comment: comment ?? null })
    .onConflictDoUpdate({
      target: [dayFeedbacks.tripId, dayFeedbacks.day, dayFeedbacks.userId],
      set: { score, comment: comment ?? null },
    })
    .returning()
  return toItem(row, args.userName)
}
