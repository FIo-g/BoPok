import 'server-only'
import { createHash } from 'node:crypto'
import { inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { MenuItemSchema, PlaceIdInputSchema, PlaceKindSchema, PlaceSummarySchema, type MenuItem } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { placeCatalog, places } from '@/lib/db/schema/places'
import { placeResearch } from '@/lib/db/schema/place-research'
import { normalizeDaejeonFood } from './daejeon-food'
import { normalizeServicePlace } from './service-catalog'
import { TourApiRecordSchema } from './tourapi'
import { toPlaceSummary } from './index'

const ProvenanceMenuSchema = MenuItemSchema.extend({ source: z.url(), checkedAt: z.iso.date() })
export const PreparedCatalogPlaceSchema = z.object({
  summary: PlaceSummarySchema.extend({ id: PlaceIdInputSchema,
    source: z.url(), checkedAt: z.iso.date(), kind: PlaceKindSchema.optional() }),
  provider: z.enum(['daejeon_food', 'tourapi']), sourceId: z.string().min(1),
  searchText: z.string().min(1), menus: z.array(ProvenanceMenuSchema),
  data: z.record(z.string(), z.json()), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type PreparedCatalogPlace = z.infer<typeof PreparedCatalogPlaceSchema>

export function prepareFoodCatalog(input: unknown): PreparedCatalogPlace {
  const saved = z.object({ raw: TourApiRecordSchema, retrievedAt: z.iso.datetime() }).parse(input)
  const entry = normalizeDaejeonFood(saved.raw, saved.retrievedAt)
  if (!entry.coord) throw new Error('좌표를 확인하지 못한 업소는 장소 DB에 넣지 않습니다.')
  const menus: MenuItem[] = entry.menus.filter(menu => menu.name.trim()).map(menu => ({
    name: menu.name, ...(menu.amountKrw === null ? {} : { priceKrw: menu.amountKrw }),
    foodTags: [], source: entry.source, checkedAt: entry.checkedAt, confidence: entry.confidence,
  }))
  return PreparedCatalogPlaceSchema.parse({
    summary: { id: entry.id, name: entry.name, category: entry.businessType ?? '음식점',
      kind: entry.kind === 'cafe' ? 'cafe' : 'restaurant', styles: [], coord: entry.coord,
      // API가 착석·실내를 확인해 주지 않는다. 확인 전에는 걷기가 끊긴다고 판정하지 않는다.
      seated: false, indoor: false, address: entry.address ?? undefined, phone: entry.phone ?? undefined,
      source: entry.source, checkedAt: entry.checkedAt, confidence: entry.confidence },
    provider: 'daejeon_food', sourceId: entry.sourceId, searchText: entry.searchText, menus,
    data: { ...entry, seatingVerified: false, indoorVerified: false, dietaryTagsVerified: false },
    contentHash: createHash('sha256').update(JSON.stringify(entry)).digest('hex'),
  })
}

export function prepareTourCatalog(input: unknown, curatedSummary?: unknown): PreparedCatalogPlace {
  const saved = z.object({ raw: z.unknown(), sources: z.array(z.object({
    endpoint: z.enum(['ldongCode2', 'lclsSystmCode2', 'areaBasedList2', 'detailCommon2', 'detailIntro2', 'detailInfo2', 'detailImage2', 'detailPetTour2']),
    retrievedAt: z.iso.datetime(), pageNo: z.number().int().positive().optional(),
  })) }).parse(input)
  const entry = normalizeServicePlace(saved.raw as Parameters<typeof normalizeServicePlace>[0], [], saved.sources)
  if (!entry.coord) throw new Error('좌표를 확인하지 못한 장소는 DB에 넣지 않습니다.')
  const summary = curatedSummary === undefined ? undefined : PlaceSummarySchema.parse(curatedSummary)
  return PreparedCatalogPlaceSchema.parse({
    summary: summary ?? { id: entry.id, name: entry.name, category: entry.kind === 'attraction' ? entry.contentTypeId === '14' ? '문화시설' : '관광지' : entry.kind === 'lodging' ? '숙박' : '음식점',
      kind: entry.kind === 'attraction' ? 'attraction' : entry.kind === 'lodging' ? 'lodging' : entry.kind === 'cafe' ? 'cafe' : 'restaurant',
      styles: [], coord: entry.coord, seated: false, indoor: false,
      address: entry.address ?? undefined, phone: entry.phone ?? undefined,
      source: entry.source, checkedAt: entry.checkedAt, confidence: entry.confidence },
    provider: 'tourapi', sourceId: entry.contentId, searchText: entry.searchText, menus: [],
    data: { ...entry, seatingVerified: false, indoorVerified: false,
      ...(summary ? { canonicalPlaceId: summary.id, canonicalSummaryPreserved: true } : {}) },
    contentHash: createHash('sha256').update(JSON.stringify(entry)).digest('hex'),
  })
}

export async function importPreparedCatalog(database: Db, input: PreparedCatalogPlace[]) {
  const entries = z.array(PreparedCatalogPlaceSchema).min(1).max(100000).parse(input)
  if (new Set(entries.map(entry => entry.summary.id)).size !== entries.length) throw new Error('적재할 장소 ID가 중복되었습니다.')
  const unchanged = new Set<string>()
  const researchState = await database.select({ ready: sql<boolean>`to_regclass('public.place_research') is not null` }).from(places).limit(1)
  // 전체 입력과 충돌을 먼저 검사한다. 실패한 실행을 재개해도 기존 수동 데이터는 덮어쓰지 않는다.
  for (let start = 0; start < entries.length; start += 500) {
    const batch = entries.slice(start, start + 500)
    const ids = batch.map(entry => entry.summary.id)
    const catalog = await database.select({ placeId: placeCatalog.placeId, contentHash: placeCatalog.contentHash })
      .from(placeCatalog).where(inArray(placeCatalog.placeId, ids))
    const existing = await database.select().from(places).where(inArray(places.id, ids))
    const byId = new Map(existing.map(row => [row.id, toPlaceSummary(row)]))
    const hashes = new Map(catalog.map(row => [row.placeId, row.contentHash]))
    const identities = researchState[0]?.ready ? await database.select({ placeId: placeResearch.placeId, data: placeResearch.data })
      .from(placeResearch).where(sql`${placeResearch.entity} = 'candidate' and ${inArray(placeResearch.placeId, ids)}`) : []
    for (const entry of batch) {
      const id = entry.summary.id
      const hash = hashes.get(id)
      if (hash && hash !== entry.contentHash) throw new Error(`기존 수집 장소 ${id}의 내용이 달라 덮어쓰지 않습니다.`)
      if (hash) { unchanged.add(id); continue }
      const previous = byId.get(id)
      if (previous && JSON.stringify(previous) !== JSON.stringify(PlaceSummarySchema.parse(entry.summary))) {
        const sameReviewedIdentity = entry.provider === 'tourapi' && identities.some(row => {
          if (row.placeId !== id) return false
          const parsed = z.object({ original: z.object({ tourApiMatch: z.object({ matchKind: z.enum(['exact_name', 'alias_address']),
            primary: z.object({ contentid: z.string() }) }) }), mapping: z.object({ dbId: z.literal(id) }) }).safeParse(row.data)
          return parsed.success && parsed.data.original.tourApiMatch.primary.contentid === entry.sourceId
        })
        // 검토된 콘텐츠 ID가 같으면 원본만 붙인다. 사람이 만든 요약·좌표는 그대로 둔다.
        if (!sameReviewedIdentity) throw new Error(`기존 장소 ${id}를 수집 자료로 덮어쓰지 않습니다.`)
      }
    }
  }
  let inserted = 0
  for (let start = 0; start < entries.length; start += 100) {
    const batch = entries.slice(start, start + 100).filter(entry => !unchanged.has(entry.summary.id))
    if (!batch.length) continue
    await database.insert(places).values(batch.map(({ summary: place }) => ({
      id: place.id, name: place.name, category: place.category, kind: place.kind,
      styles: place.styles, lng: place.coord[0], lat: place.coord[1],
      seated: place.seated, indoor: place.indoor, address: place.address, phone: place.phone,
      homepage: place.homepage, visitMin: place.visitMin,
      source: place.source, checkedAt: place.checkedAt, confidence: place.confidence,
    }))).onConflictDoNothing({ target: places.id })
    const saved = await database.insert(placeCatalog).values(batch.map(entry => ({
      placeId: entry.summary.id, provider: entry.provider, sourceId: entry.sourceId,
      searchText: entry.searchText, menus: entry.menus, contentHash: entry.contentHash, data: entry.data,
    }))).onConflictDoNothing({ target: placeCatalog.placeId }).returning({ id: placeCatalog.placeId })
    inserted += saved.length
  }
  return { inserted, unchanged: unchanged.size, total: entries.length }
}
