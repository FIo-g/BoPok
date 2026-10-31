// 여행과 함께 가는 사람. 담당: 김경선. 설계 10.3, 계약은 src/lib/contracts/trip-api.ts·traveler.ts.
// 버전·의견(trip_versions, version_opinions)과 trip_interviews는 4단계 이후에 더한다.
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { Condition } from '@/lib/contracts'
import { user } from './auth'
import { groups } from './groups'

const uuid = () => crypto.randomUUID()

export const trips = pgTable(
  'trips',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // 'YYYY-MM-DD' 문자열로 주고받는다 (mode: 'string'). Date 객체로 받으면 시간대 때문에 날짜가 하루 밀린다
    date: date('date', { mode: 'string' }),
    startMode: text('start_mode', { enum: ['paste', 'scratch'] }).notNull(), // 계약의 mode
    transport: text('transport', { enum: ['car', 'transit', 'taxi'] }),
    styles: text('styles').array().notNull().default([]),
    budget: text('budget', { enum: ['under_30k', '30k_50k', '50k_100k', 'over_100k'] }),
    // 확정은 4단계에서 채운다. 지금은 항상 null (null이면 '작성 중'이다 — 따로 status 칸을 두지 않는다).
    // trip_versions 테이블이 아직 없어서 외래키를 걸지 않았다 — 4단계에서 건다.
    confirmedVersionId: text('confirmed_version_id'),
    confirmedByUserId: text('confirmed_by_user_id').references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  // 그룹 화면의 여행 목록은 group_id로 찾는다.
  table => [index('trips_groupId_idx').on(table.groupId)],
)

export const tripTravelers = pgTable(
  'trip_travelers',
  {
    // id는 화면·AI가 만들어 보낸 값을 그대로 쓴다 (계약 Traveler.id).
    // 여행마다 't1' 같은 짧은 id가 올 수 있어 (trip_id, id)를 묶어 기본키로 둔다.
    id: text('id').notNull(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // 그룹 구성원 계정과 연결되면 채운다. 계정이 없는 사람(예: 할머니)은 null
    userId: text('user_id').references(() => user.id),
    label: text('label').notNull(), // 엄마, 아빠, 나 …
    age: integer('age'),
    heightCm: doublePrecision('height_cm'), // 계약이 정수가 아니라 number다
    sex: text('sex', { enum: ['female', 'male'] }),
    pace: text('pace', { enum: ['slow', 'normal', 'unknown'] }).notNull(),
    mobilityAid: boolean('mobility_aid').notNull().default(false),
    isParent: boolean('is_parent').notNull().default(false), // 부모님. 걷기 조건에 80% 비중 (설계 7.1.1)
    // 걷기 조건 답. 비어 있으면 엔진이 기본값을 쓴다
    condition: jsonb('condition').$type<Partial<Condition>>().notNull().default({}),
    filledBySelf: boolean('filled_by_self').notNull().default(false), // 서버가 정한다 (본인 계정이 고쳤을 때 true)
    // 계약 Traveler에 순서 칸이 없고 화면은 배열 순서를 믿는다 → 받은 순서를 여기 적어 그대로 돌려준다
    sortOrder: integer('sort_order').notNull(),
  },
  table => [primaryKey({ columns: [table.tripId, table.id] }), index('trip_travelers_tripId_idx').on(table.tripId)],
)
