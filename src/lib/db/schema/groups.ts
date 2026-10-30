// 그룹·구성원·초대. 담당: 김경선. 설계 10.3.
import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

// id는 DB 함수(gen_random_uuid) 대신 JS에서 만든다 — PGlite와 Neon에서 같게 돌게.
const uuid = () => crypto.randomUUID()

// 가족 단위. 만든 사람이 그룹장(owner)이 된다.
export const groups = pgTable('groups', {
  id: text('id').primaryKey().$defaultFn(uuid),
  name: text('name').notNull(),
  // 계정을 지우는 기능은 MVP에 없으므로 cascade를 걸지 않는다 (지우려 하면 DB가 막는다).
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// 누가 어느 그룹에 속하는지. 한 사람이 여러 그룹에 속할 수 있다 (설계 4.1).
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // owner만 초대 링크 만들기·구성원 내보내기를 할 수 있다 (설계 10.4).
    // PostgreSQL enum 대신 text로 둔다 — enum은 나중에 값을 더할 때 마이그레이션이 까다롭다.
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    relation: text('relation'), // 엄마·아들처럼 가족 안에서의 관계. 안 적어도 된다
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  table => [
    // 같은 그룹에 같은 사람이 두 줄 생기지 않게 (group_id, user_id)를 기본키로 묶는다.
    primaryKey({ columns: [table.groupId, table.userId] }),
    // '내 그룹 목록'은 user_id로 찾는다 (GET /api/groups).
    index('group_members_userId_idx').on(table.userId),
  ],
)

// 초대 링크. 링크 하나로 여러 명이 참가할 수 있고, 7일 뒤 만료된다 (설계 10.3).
// '사용함' 표시를 두지 않는 이유: 가족 단톡방에 링크를 한 번 올리면 엄마·아빠·동생이
// 각각 눌러 들어와야 한다.
export const groupInvites = pgTable(
  'group_invites',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    // 32바이트 무작위를 base64url로 적은 값(43글자). 링크로 찾으므로 unique.
    token: text('token').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    // 만료는 지울 때가 아니라 읽을 때 현재 시각과 비교한다 (지나간 링크는 410).
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  // 그룹 화면에서 '이 그룹의 초대 링크'를 찾을 때 쓴다.
  table => [index('group_invites_groupId_idx').on(table.groupId)],
)
