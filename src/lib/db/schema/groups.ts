// 그룹과 구성원. 담당: 김경선. 설계 10.3.
// 1단계에서는 requireMember/requireOwner가 "이 사람이 이 그룹 구성원인가"를 볼 때만 쓴다.
// 초대(group_invites)는 2단계에서 더한다.
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
