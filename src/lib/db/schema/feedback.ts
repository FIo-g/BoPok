// 일차별 만족도. 담당: 김경선. 설계 2026-11-02 4.3, 계약은 src/lib/contracts/feedback.ts.
import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { trips } from './trips'

// 한 사람이 그날에 하나만 남긴다. 다시 쓰면 덮어쓴다 — 그래서 (여행, 날, 사람)이 기본키다.
export const dayFeedbacks = pgTable(
  'day_feedbacks',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(), // 여행 몇째 날 (Stop.day와 같은 기준, 1부터)
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    score: integer('score').notNull(), // 1~5. 범위는 계약(DayFeedbackInputSchema)이 검사한다
    comment: text('comment'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => [primaryKey({ columns: [table.tripId, table.day, table.userId] })],
)
