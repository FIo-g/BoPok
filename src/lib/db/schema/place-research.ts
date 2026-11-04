// Drizzle가 직접 읽는 선언이며 서버 접근은 places/research-import가 맡는다.
import { jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
export const placeResearch = pgTable('place_research', {
  namespace: text('namespace').notNull(),
  entity: text('entity').notNull(),
  externalId: text('external_id').notNull(),
  placeId: text('place_id'),
  hash: text('hash').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
}, table => [primaryKey({ columns: [table.namespace, table.entity, table.externalId] })])
