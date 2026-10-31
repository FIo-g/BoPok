import 'server-only'
import { and, arrayOverlaps, asc, ilike, inArray } from 'drizzle-orm'
import {
  PlaceDetailsResponseSchema, PlaceListQuerySchema,
  PlaceSummaryListSchema, PlaceSummarySchema, type PlaceDetail, type PlaceSummary,
} from '@/lib/contracts'
import { BoundedPlaceDetailsRequestSchema } from './validation'
import { getDb, type Db } from '@/lib/db/client'
import { placeNodes, places, placeSegments } from '@/lib/db/schema/places'

type PlaceRow = typeof places.$inferSelect

export function toPlaceSummary(row: PlaceRow): PlaceSummary {
  return PlaceSummarySchema.parse({
    id: row.id, name: row.name, category: row.category, styles: row.styles,
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
  const rows = await db.select().from(places).where(and(
    query.q ? ilike(places.name, `%${pattern}%`) : undefined,
    query.styles.length ? arrayOverlaps(places.styles, query.styles) : undefined,
  )).orderBy(asc(places.name), asc(places.id))
  return PlaceSummaryListSchema.parse(rows.map(toPlaceSummary))
}

export async function getPlaceDetails(ids: string[], database?: Db): Promise<PlaceDetail[]> {
  const input = BoundedPlaceDetailsRequestSchema.parse({ ids })
  const uniqueIds = [...new Set(input.ids)]
  if (!uniqueIds.length) return []
  const db = database ?? getDb()
  const rows = await db.select().from(places).where(inArray(places.id, uniqueIds))
  if (!rows.length) return []
  const foundIds = rows.map(row => row.id)
  // PGlite는 한 연결을 사용하므로 관련 조회도 순서대로 실행한다.
  const nodes = await db.select().from(placeNodes).where(inArray(placeNodes.placeId, foundIds)).orderBy(asc(placeNodes.id))
  const segments = await db.select().from(placeSegments).where(inArray(placeSegments.placeId, foundIds))
    .orderBy(asc(placeSegments.order), asc(placeSegments.id))
  const byId = new Map(rows.map(row => [row.id, {
    ...toPlaceSummary(row),
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
