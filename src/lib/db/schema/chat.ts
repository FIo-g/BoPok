// 그룹 채팅. 담당: 김경선. 설계 2026-11-02 4.5, 계약은 src/lib/contracts/chat.ts.
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { trips } from './trips'

const uuid = () => crypto.randomUUID()

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    text: text('text').notNull(),
    // 화면이 이 시각을 커서(after)로 쓴다. 시간대가 어긋나면 글을 놓치므로 시간대를 함께 저장한다
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // 여행마다 '이 시각 이후의 글'을 찾는다
  table => [index('chat_messages_tripId_createdAt_idx').on(table.tripId, table.createdAt)],
)
