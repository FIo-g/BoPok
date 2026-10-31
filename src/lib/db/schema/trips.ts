// 여행·여행자·버전·의견. 담당: 김경선. 설계 10.3, 계약은 src/lib/contracts/trip-api.ts·version.ts.
// trip_interviews는 김태형과 컬럼을 합의한 뒤에 더한다.
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Condition, InterviewState, JudgeSummary, Reaction, Stop } from '@/lib/contracts'
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
    // 확정은 5단계에서 채운다. null이면 '작성 중'이다 (따로 status 칸을 두지 않는다).
    // trips와 trip_versions가 서로를 가리켜서, 타입이 순환하지 않게 AnyPgColumn을 적어 준다.
    confirmedVersionId: text('confirmed_version_id').references((): AnyPgColumn => tripVersions.id),
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

// 일정 한 판. 직접 고친 것·빠른 수정안·AI가 짠 것이 모두 여기 쌓인다 (설계 10.3).
export const tripVersions = pgTable(
  'trip_versions',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // 여행마다 1, 2, 3… 화면이 'v2'처럼 보여 준다
    number: integer('number').notNull(),
    // 어느 버전을 고쳐서 만든 것인지. 처음 버전은 null
    parentId: text('parent_id').references((): AnyPgColumn => tripVersions.id),
    madeBy: text('made_by', { enum: ['user', 'ai', 'quick_fix'] }).notNull(),
    madeByUserId: text('made_by_user_id').references(() => user.id),
    stops: jsonb('stops').$type<Stop[]>().notNull(),
    // 판정 요약(판정·이유·하루 총·가장 긴 연속). 엔진 연결은 6단계라 그때까지 null
    judgeSummary: jsonb('judge_summary').$type<JudgeSummary>(),
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => [
    // 번호가 겹치지 않게 DB가 막는다. db.transaction()을 못 쓰므로(Neon HTTP)
    // '번호를 세어 넣고, 겹치면 다시 시도'하는 방식의 안전장치다.
    unique('trip_versions_trip_number_unique').on(table.tripId, table.number),
    index('trip_versions_tripId_idx').on(table.tripId),
  ],
)

// 장소별 반응·한 줄 의견 (설계 5장, 10.3). 표만 먼저 만들어 둔다 —
// 의견 API와 createVersion의 appliedOpinionIds 연결은 5단계다 (마이그레이션을 두 번 만들지 않으려고).
export const versionOpinions = pgTable(
  'version_opinions',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    versionId: text('version_id')
      .notNull()
      .references(() => tripVersions.id, { onDelete: 'cascade' }),
    stopKey: text('stop_key'), // null이면 일정 전체에 대한 의견
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    reactions: text('reactions').array().$type<Reaction[]>().notNull().default([]),
    comment: text('comment'),
    // 이 의견이 반영된 버전 (다시 짜기 결과)
    appliedInVersionId: text('applied_in_version_id').references((): AnyPgColumn => tripVersions.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  table => [index('version_opinions_versionId_idx').on(table.versionId)],
)

// AI 인터뷰의 진행 상태(InterviewState)를 여행마다 한 줄로 통째로 저장한다.
// 김태형의 src/lib/ai는 이 표를 직접 쓰지 않고 src/lib/trips의 interviews.get/save로만 읽고 쓴다.
// 칸을 나누지 않고 jsonb 한 칸에 두는 이유: 상태의 모양이 인터뷰 질문과 함께 자주 바뀐다.
export const tripInterviews = pgTable('trip_interviews', {
  tripId: text('trip_id')
    .primaryKey()
    .references(() => trips.id, { onDelete: 'cascade' }),
  state: jsonb('state').$type<InterviewState>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
