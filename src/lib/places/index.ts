import 'server-only'
import { and, arrayOverlaps, asc, ilike, inArray, sql } from 'drizzle-orm'
import {
  PlaceDetailsResponseSchema, PlaceListQuerySchema,
  PlaceSummaryListSchema, PlaceSummarySchema, type PlaceDetail, type PlaceSummary, type PlaceKind,
} from '@/lib/contracts'
import { BoundedPlaceDetailsRequestSchema } from './validation'
import { getDb, type Db } from '@/lib/db/client'
import { placeCatalog, placeNodes, places, placeSegments } from '@/lib/db/schema/places'
import { placeResearch } from '@/lib/db/schema/place-research'

type PlaceRow = typeof places.$inferSelect

// 공용 DB에 새 마이그레이션이 적용되기 전에도 기존 목록·상세 조회는 유지한다.
export const placeSummaryColumns = {
  id: places.id, name: places.name, category: places.category,
  kind: sql<PlaceKind | null>`to_jsonb(${places})->>'kind'`,
  styles: places.styles, lng: places.lng, lat: places.lat, visitMin: places.visitMin,
  seated: places.seated, indoor: places.indoor, address: places.address, phone: places.phone,
  homepage: places.homepage, source: places.source, checkedAt: places.checkedAt, confidence: places.confidence,
}

export async function hasPlaceCatalog(db: Db): Promise<boolean> {
  const rows = await db.select({ ready: sql<boolean>`to_regclass('public.place_catalog') is not null` }).from(places).limit(1)
  return rows[0]?.ready ?? false
}

export function toPlaceSummary(row: PlaceRow): PlaceSummary {
  return PlaceSummarySchema.parse({
    id: row.id, name: row.name, category: row.category, kind: row.kind ?? undefined, styles: row.styles,
    coord: [row.lng, row.lat], visitMin: row.visitMin ?? undefined,
    seated: row.seated, indoor: row.indoor, address: row.address ?? undefined,
    phone: row.phone ?? undefined, homepage: row.homepage ?? undefined,
    source: row.source, checkedAt: row.checkedAt, confidence: row.confidence,
  })
}

export async function listPlaces(filters: unknown = {}, database?: Db): Promise<PlaceSummary[]> {
  const query = PlaceListQuerySchema.parse(filters)
  const db = database ?? getDb()
  // SQL 매개변수 처리에 더해 %와 _도 검색어의 문자로 취급한다.
  const pattern = query.q.replace(/[\\%_]/g, '\\$&')
  const selection = db.select(placeSummaryColumns).from(places).where(and(
    query.q ? ilike(places.name, `%${pattern}%`) : undefined,
    query.styles.length ? arrayOverlaps(places.styles, query.styles) : undefined,
    query.kind ? sql`coalesce(to_jsonb(${places})->>'kind', 'attraction') = ${query.kind}` : undefined,
  )).orderBy(asc(places.name), asc(places.id))
  const rows = await (query.limit ? selection.limit(query.limit) : selection)
  return PlaceSummaryListSchema.parse(rows.map(toPlaceSummary))
}

export async function getPlaceDetails(ids: string[], database?: Db): Promise<PlaceDetail[]> {
  const input = BoundedPlaceDetailsRequestSchema.parse({ ids })
  const uniqueIds = [...new Set(input.ids)]
  if (!uniqueIds.length) return []
  const db = database ?? getDb()
  const rows = await db.select(placeSummaryColumns).from(places).where(inArray(places.id, uniqueIds))
  if (!rows.length) return []
  const foundIds = rows.map(row => row.id)
  // PGlite는 한 연결을 사용하므로 관련 조회도 순서대로 실행한다.
  const nodes = await db.select().from(placeNodes).where(inArray(placeNodes.placeId, foundIds)).orderBy(asc(placeNodes.id))
  const segments = await db.select().from(placeSegments).where(inArray(placeSegments.placeId, foundIds))
    .orderBy(asc(placeSegments.order), asc(placeSegments.id))
  const menus = await hasPlaceCatalog(db)
    ? await db.select({ placeId: placeCatalog.placeId, menus: placeCatalog.menus }).from(placeCatalog)
      .where(inArray(placeCatalog.placeId, foundIds))
    : []
  const menusById = new Map(menus.map(row => [row.placeId, row.menus]))
  const researchReady = await db.select({ ready: sql<boolean>`to_regclass('public.place_research') is not null` }).from(places).limit(1)
  const researchRows = researchReady[0]?.ready ? await db.select({ placeId: placeResearch.placeId }).from(placeResearch)
    .where(and(inArray(placeResearch.placeId, foundIds), sql`${placeResearch.entity} = 'candidate'`)) : []
  const byId = new Map(rows.map(row => [row.id, {
    ...toPlaceSummary(row),
    ...(researchRows.some(item => item.placeId === row.id) ? { research: {
      candidateCount: researchRows.filter(item => item.placeId === row.id).length, continuousWheelchairAccess: 'unverified',
      notice: '공개자료 조사 결과예요. 대표점은 입구가 아니며 전체 동선·계단·휴식시설은 현장 미검증이에요. 보류 근거와 주변 지도 객체는 판정에 사용하지 않아요.',
    } } : {}),
    ...(menusById.has(row.id) ? { menus: menusById.get(row.id) } : {}),
    nodes: nodes.filter(node => node.placeId === row.id).map(node => ({
      id: node.id, placeId: node.placeId, kind: node.kind, name: node.name,
      restType: node.restType, coord: [node.lng, node.lat],
    })),
    segments: segments.filter(segment => segment.placeId === row.id).map(segment => ({
      ...segment, stairsCount: segment.stairsCount ?? undefined, detourOf: segment.detourOf ?? undefined,
    })),
  }]))
  return PlaceDetailsResponseSchema.parse(uniqueIds.flatMap(id => {
    const detail = byId.get(id)
    return detail ? [detail] : []
  }))
}

export async function getPlaceDetail(id: string): Promise<PlaceDetail | null> {
  return (await getPlaceDetails([id]))[0] ?? null
}
