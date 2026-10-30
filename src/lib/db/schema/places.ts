// drizzle-kit이 일반 Node로 읽는 파일이라 server-only를 두지 않는다 (auth.ts·groups.ts도 같음). 서버 전용 보호는 client.ts가 맡는다.
import { sql } from 'drizzle-orm'
import {
  boolean, check, doublePrecision, foreignKey, index, integer, jsonb,
  pgEnum, pgTable, primaryKey, text, timestamp,
} from 'drizzle-orm/pg-core'
import { ConfidenceSchema, StairsStatusSchema, TransportSchema, type Coord } from '../../contracts/common'
import { PlaceNodeKindSchema } from '../../contracts/place'

export const placeConfidence = pgEnum('place_confidence', ConfidenceSchema.enum)
export const placeStairsStatus = pgEnum('place_stairs_status', StairsStatusSchema.enum)
export const placeNodeKind = pgEnum('place_node_kind', PlaceNodeKindSchema.enum)
export const placeRestType = pgEnum('place_rest_type', ['indoor', 'outdoor'])
export const legTransport = pgEnum('leg_transport', TransportSchema.enum)

// 계약에서 생략 가능한 출처도 실제 저장 데이터에는 반드시 붙인다.
function provenance() {
  return {
    source: text('source').notNull(),
    checkedAt: text('checked_at').notNull(),
    confidence: placeConfidence('confidence').notNull(),
  }
}

export const places = pgTable('places', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  styles: text('styles').array().notNull(),
  lng: doublePrecision('lng').notNull(),
  lat: doublePrecision('lat').notNull(),
  visitMin: doublePrecision('visit_min'),
  seated: boolean('seated').notNull(),
  indoor: boolean('indoor').notNull(),
  address: text('address'),
  phone: text('phone'),
  homepage: text('homepage'),
  ...provenance(),
}, table => [
  check('places_name_nonempty', sql`length(${table.name}) > 0`),
  check('places_coord_range', sql`${table.lng} between -180 and 180 and ${table.lat} between -90 and 90`),
  check('places_visit_min_nonnegative', sql`${table.visitMin} >= 0 and ${table.visitMin} < 'Infinity'::float8`),
  check('places_source_nonempty', sql`length(trim(${table.source})) > 0`),
  check('places_checked_at_nonempty', sql`length(trim(${table.checkedAt})) > 0`),
])

export const placeNodes = pgTable('place_nodes', {
  id: text('id').notNull(),
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  kind: placeNodeKind('kind').notNull(),
  name: text('name').notNull(),
  restType: placeRestType('rest_type'),
  lng: doublePrecision('lng').notNull(),
  lat: doublePrecision('lat').notNull(),
}, table => [
  // parking 같은 지점 ID를 서로 다른 장소에서 재사용할 수 있다.
  primaryKey({ columns: [table.placeId, table.id] }),
  check('place_nodes_coord_range', sql`${table.lng} between -180 and 180 and ${table.lat} between -90 and 90`),
])

export const placeSegments = pgTable('place_segments', {
  id: text('id').notNull(),
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  fromNodeId: text('from_node_id').notNull(),
  toNodeId: text('to_node_id').notNull(),
  order: integer('order').notNull(),
  distanceM: doublePrecision('distance_m').notNull(),
  // 계약과 같은 [경도, 위도][]를 저장하며, 돌아오는 길의 반전은 엔진이 맡는다.
  path: jsonb('path').$type<Coord[]>().notNull(),
  stairsStatus: placeStairsStatus('stairs_status').notNull(),
  stairsCount: integer('stairs_count'),
  slope: boolean('slope').notNull(),
  optional: boolean('optional').notNull(),
  detourOf: text('detour_of'),
  ...provenance(),
}, table => [
  primaryKey({ columns: [table.placeId, table.id] }),
  foreignKey({ name: 'place_segments_from_node_fk', columns: [table.placeId, table.fromNodeId], foreignColumns: [placeNodes.placeId, placeNodes.id] }),
  foreignKey({ name: 'place_segments_to_node_fk', columns: [table.placeId, table.toNodeId], foreignColumns: [placeNodes.placeId, placeNodes.id] }),
  foreignKey({ name: 'place_segments_detour_fk', columns: [table.placeId, table.detourOf], foreignColumns: [table.placeId, table.id] }),
  index('place_segments_place_order_idx').on(table.placeId, table.order),
  check('place_segments_order_nonnegative', sql`${table.order} >= 0`),
  check('place_segments_distance_nonnegative', sql`${table.distanceM} >= 0 and ${table.distanceM} < 'Infinity'::float8`),
  check('place_segments_path_array', sql`jsonb_typeof(${table.path}) = 'array'`),
  check('place_segments_path_length', sql`jsonb_array_length(${table.path}) >= 2`),
  check('place_segments_stairs_count_nonnegative', sql`${table.stairsCount} >= 0`),
  check('place_segments_detour_not_self', sql`${table.detourOf} <> ${table.id}`),
  check('place_segments_source_nonempty', sql`length(trim(${table.source})) > 0`),
  check('place_segments_checked_at_nonempty', sql`length(trim(${table.checkedAt})) > 0`),
])

export const legCache = pgTable('leg_cache', {
  // 키 생성 규칙을 중복 구현하지 않고 contracts의 legKey(request)를 그대로 저장한다.
  key: text('key').primaryKey(),
  mode: legTransport('mode').notNull(),
  distanceM: doublePrecision('distance_m').notNull(),
  durationMin: doublePrecision('duration_min'),
  path: jsonb('path').$type<Coord[]>().notNull(),
  stairsStatus: placeStairsStatus('stairs_status').notNull(),
  stairsCount: integer('stairs_count'),
  fareKrw: doublePrecision('fare_krw'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  ...provenance(),
}, table => [
  check('leg_cache_distance_nonnegative', sql`${table.distanceM} >= 0 and ${table.distanceM} < 'Infinity'::float8`),
  check('leg_cache_duration_nonnegative', sql`${table.durationMin} >= 0 and ${table.durationMin} < 'Infinity'::float8`),
  check('leg_cache_fare_nonnegative', sql`${table.fareKrw} >= 0 and ${table.fareKrw} < 'Infinity'::float8`),
  check('leg_cache_path_array', sql`jsonb_typeof(${table.path}) = 'array'`),
  check('leg_cache_stairs_count_nonnegative', sql`${table.stairsCount} >= 0`),
  check('leg_cache_source_nonempty', sql`length(trim(${table.source})) > 0`),
  check('leg_cache_checked_at_nonempty', sql`length(trim(${table.checkedAt})) > 0`),
])
