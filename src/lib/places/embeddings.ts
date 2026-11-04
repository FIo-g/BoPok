import 'server-only'
import { and, eq, or, isNull, ne, sql, asc } from 'drizzle-orm'
import { PlaceKindSchema, type PlaceKind } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { placeCatalog, places } from '@/lib/db/schema/places'
import { embedPlaceTexts, PlaceEmbeddingSchema, PLACE_PASSAGE_MODEL } from '@/lib/ai/place-embeddings'

export async function indexPlaceEmbeddings(db: Db, options: {
  limit?: number; maxRequests?: number; kind?: PlaceKind; embed?: (texts: string[]) => Promise<number[][]>
} = {}) {
  const limit = options.limit ?? 16
  const maxRequests = options.maxRequests ?? 1
  const kind = options.kind === undefined ? undefined : PlaceKindSchema.parse(options.kind)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20000 || !Number.isSafeInteger(maxRequests) || maxRequests < 0) {
    throw new Error('임베딩 처리 상한을 확인해 주세요.')
  }
  const rows = await db.select({ id: placeCatalog.placeId, passage: placeCatalog.searchText, hash: placeCatalog.contentHash })
    .from(placeCatalog).innerJoin(places, eq(places.id, placeCatalog.placeId))
    .leftJoin(sql`place_embeddings`, sql`place_embeddings.place_id = ${placeCatalog.placeId}`)
    .where(and(kind ? eq(sql<string>`coalesce(${places.kind}, 'attraction')`, kind) : undefined,
      or(isNull(sql`place_embeddings.place_id`), ne(sql`place_embeddings.model`, PLACE_PASSAGE_MODEL),
        ne(sql`place_embeddings.content_hash`, placeCatalog.contentHash))))
    .orderBy(asc(placeCatalog.placeId)).limit(Math.min(limit, maxRequests * 16))
  let indexed = 0
  let requests = 0
  for (let start = 0; start < rows.length; start += 16) {
    const batch = rows.slice(start, start + 16)
    const passages = batch.map(row => row.passage.slice(0, 6000))
    const vectors = await (options.embed ?? (texts => embedPlaceTexts(texts, 'passage')))(passages)
    requests++
    if (vectors.length !== batch.length) throw new Error('장소와 임베딩 개수가 다릅니다.')
    const checked = vectors.map(vector => PlaceEmbeddingSchema.parse(vector))
    // 한 배치는 한 SQL로 저장해 공유 DB 왕복을 줄인다. 같은 원문·모델은 위 조회에서 제외된다.
    const values = batch.map((row, index) => sql`(${row.id}, ${PLACE_PASSAGE_MODEL}, ${row.hash}, ${passages[index]}, ${JSON.stringify(checked[index])}::vector)`)
    await db.execute(sql`insert into place_embeddings(place_id, model, content_hash, passage, embedding)
      values ${sql.join(values, sql`, `)}
      on conflict (place_id) do update set model = excluded.model, content_hash = excluded.content_hash,
        passage = excluded.passage, embedding = excluded.embedding, updated_at = now()`)
    indexed += batch.length
  }
  const placeCount = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(places)
  return { indexed, requests, placeCount: placeCount[0].count }
}
