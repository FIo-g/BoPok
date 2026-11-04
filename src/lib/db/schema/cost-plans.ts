// 비용 기능(이동주). 여행·버전 코드를 직접 바꾸지 않고 버전별 비용 초안을 별도 보관한다.
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { SaveCostPlan } from '@/lib/contracts'
import { tripVersions } from './trips'
import { user } from './auth'

export const versionCostPlans = pgTable('version_cost_plans', {
  versionId: text('version_id').notNull().references(() => tripVersions.id, { onDelete: 'cascade' }),
  day: integer('day').notNull(),
  partySize: integer('party_size').notNull(),
  context: text('context').notNull(),
  drafts: jsonb('drafts').$type<SaveCostPlan['drafts']>().notNull(),
  extraCount: integer('extra_count').notNull(),
  revision: integer('revision').notNull(),
  updatedByUserId: text('updated_by_user_id').notNull().references(() => user.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.versionId, table.day] })])
