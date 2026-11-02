// 그룹 채팅. 담당: 김경선 (설계 2026-11-02 4.5).
// 권한 검사는 여기서 하지 않는다 — route가 requireTripMember로 먼저 막는다.
import 'server-only'
import { and, asc, desc, eq, gte } from 'drizzle-orm'
import type { ChatMessage } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { getDb } from '@/lib/db/client'
import { chatMessages, user } from '@/lib/db/schema'

// 처음 열 때 보여 줄 최근 글 수. 오래 쌓여도 응답이 커지지 않게 한다
export const CHAT_RECENT_MAX = 100

type Row = typeof chatMessages.$inferSelect

function toMessage(row: Row, userName: string): ChatMessage {
  return {
    id: row.id,
    tripId: row.tripId,
    userId: row.userId,
    userName,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  }
}

const withName = { message: chatMessages, userName: user.name }

// 커서 after가 없으면 최근 글, 있으면 그 시각 이후의 글. 같은 시각도 포함하므로(>=) 화면이 id로 중복을 거른다.
// 돌려주는 순서는 언제나 오래된 글이 먼저다.
export async function listChatMessages(
  args: { tripId: string; after?: string },
  db: Db = getDb(),
): Promise<ChatMessage[]> {
  const base = db.select(withName).from(chatMessages).innerJoin(user, eq(user.id, chatMessages.userId))

  if (args.after !== undefined) {
    const rows = await base
      .where(and(eq(chatMessages.tripId, args.tripId), gte(chatMessages.createdAt, new Date(args.after))))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .limit(CHAT_RECENT_MAX)
    return rows.map(row => toMessage(row.message, row.userName))
  }

  const rows = await base
    .where(eq(chatMessages.tripId, args.tripId))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(CHAT_RECENT_MAX)
  return rows.reverse().map(row => toMessage(row.message, row.userName))
}

// 이름은 세션에서 받는다. 클라이언트가 보낸 이름을 쓰지 않는다.
export async function postChatMessage(
  args: { tripId: string; userId: string; userName: string; text: string },
  db: Db = getDb(),
): Promise<ChatMessage> {
  const [row] = await db
    .insert(chatMessages)
    .values({ tripId: args.tripId, userId: args.userId, text: args.text })
    .returning()
  return toMessage(row, args.userName)
}
