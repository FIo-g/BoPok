import 'server-only'
import { and, asc, eq, ilike, sql, type SQL } from 'drizzle-orm'
import { PlaceRecommendationRequestSchema, PlaceRecommendationResponseSchema, type Coord,
  type PlaceRecommendationResponse } from '@/lib/contracts'
import { getDb, type Db } from '@/lib/db/client'
import { placeCatalog, places, placeSegments } from '@/lib/db/schema/places'
import { embedPlaceTexts, PlaceEmbeddingSchema, PLACE_PASSAGE_MODEL } from '@/lib/ai/place-embeddings'
import { straightLineDistanceM } from '@/lib/geo/straight-line'
import { hasPlaceCatalog, placeSummaryColumns, toPlaceSummary } from './index'

export function sqlStraightLineDistanceM(coord: Coord): SQL<number> {
  return sql<number>`(2 * 6371000 * asin(sqrt(least(1.0, greatest(0.0,
    power(sin(radians(${places.lat} - ${coord[1]}) / 2), 2)
    + cos(radians(${places.lat})) * cos(radians(${coord[1]}))
    * power(sin(radians(${places.lng} - ${coord[0]}) / 2), 2))))))`
}

export async function recommendServicePlaces(input: unknown, options: {
  db?: Db; embedQuery?: (query: string) => Promise<number[]>
} = {}): Promise<PlaceRecommendationResponse> {
  const query = PlaceRecommendationRequestSchema.parse(input)
  const db = options.db ?? getDb()
  if (!await hasPlaceCatalog(db)) return {
    catalogReady: false, method: 'keyword', distanceBasis: 'straight_line', routeCheckRequired: true, items: [],
  }
  const distance = query.near ? sqlStraightLineDistanceM(query.near) : sql<number | null>`null`
  const route = query.route
  const detour = route ? sql<number>`greatest(0, ${sqlStraightLineDistanceM(route[0])} + ${sqlStraightLineDistanceM(route[1])}
    - ${straightLineDistanceM(route[0], route[1])})`
    : sql<number | null>`null`
  const columns = { ...placeSummaryColumns, menus: placeCatalog.menus,
    distanceM: distance.as('distance_m'), detourM: detour.as('detour_m') }
  const kind = sql`coalesce(to_jsonb(${places})->>'kind', 'attraction') = ${query.kind}`
  // 후보 수를 자른 뒤 재정렬하면 계단 미기록 후보가 처음부터 누락될 수 있다.
  // 기존 계약대로 present만 뒤로 보내며 unknown을 접근 가능으로 판정하지 않는다.
  const stairsOrder = query.avoidStairs ? [asc(sql`case when exists (select 1 from ${placeSegments}
    where ${placeSegments.placeId} = ${places.id} and ${placeSegments.stairsStatus} = 'present') then 1 else 0 end`)] : []
  const order = [...(route ? [asc(detour)] : []), ...(query.near ? [asc(distance)] : []), asc(places.name), asc(places.id)]
  let method: 'vector' | 'keyword' = 'keyword'
  const keyword = () => db.select(columns).from(places).innerJoin(placeCatalog, eq(placeCatalog.placeId, places.id))
    .where(and(kind, query.query ? ilike(placeCatalog.searchText, `%${query.query.replace(/[\\%_]/g, '\\$&')}%`) : undefined))
    .orderBy(...stairsOrder, ...order).limit(query.limit)
  let found: Awaited<ReturnType<typeof keyword>> | undefined
  if (query.query && (options.embedQuery || process.env.UPSTAGE_API_KEY)) {
    const state = await db.select({ ready: sql<boolean>`to_regclass('public.place_embeddings') is not null` }).from(places).limit(1)
    if (state[0]?.ready) {
      try {
        // 일부만 색인된 종류는 벡터 검색을 건너뛴다. 조인으로 걸러지면 일부 장소만 놓고 벡터 결과라고 표시하게 된다.
        // 질의 임베딩 호출도 건너뛰어 키 사용을 줄인다.
        const [coverage] = await db.select({
          embedded: sql<number>`count(distinct place_embeddings.place_id)`,
          total: sql<number>`count(distinct place_catalog.place_id)`,
        }).from(placeCatalog).innerJoin(places, eq(places.id, placeCatalog.placeId))
          .leftJoin(sql`place_embeddings`, sql`place_embeddings.place_id = ${placeCatalog.placeId}
            and place_embeddings.content_hash = ${placeCatalog.contentHash} and place_embeddings.model = ${PLACE_PASSAGE_MODEL}`)
          .where(kind)
        const embedded = Number(coverage?.embedded ?? 0)
        const total = Number(coverage?.total ?? 0)
        if (embedded > 0 && embedded >= total) {
          const vector = PlaceEmbeddingSchema.parse(await (options.embedQuery ?? (async text => (await embedPlaceTexts([text], 'query'))[0]))(query.query))
          const similarity = sql`place_embeddings.embedding <=> ${JSON.stringify(vector)}::vector`
          const result = await db.select(columns).from(places).innerJoin(placeCatalog, eq(placeCatalog.placeId, places.id))
            .innerJoin(sql`place_embeddings`, sql`place_embeddings.place_id = ${places.id}
              and place_embeddings.content_hash = ${placeCatalog.contentHash} and place_embeddings.model = ${PLACE_PASSAGE_MODEL}`)
            .where(kind).orderBy(...stairsOrder, asc(similarity), ...order).limit(query.limit)
          if (result.length) { found = result; method = 'vector' }
        }
      } catch {
        // 키·DB 내부 정보·외부 오류는 돌려주지 않고, 응답에 실제 검색 방식을 명시한다.
      }
    }
  }
  found ??= await keyword()
  return PlaceRecommendationResponseSchema.parse({
    catalogReady: true, method, distanceBasis: 'straight_line', routeCheckRequired: true,
    items: found.map(row => ({ place: toPlaceSummary(row), menus: row.menus.slice(0, 5),
      distanceM: row.distanceM === null ? undefined : Math.round(Number(row.distanceM)),
      straightLineDetourM: row.detourM === null ? undefined : Math.max(0, Math.round(Number(row.detourM))),
    })),
  })
}
