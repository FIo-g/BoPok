import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { places } from '@/lib/db/schema/places'
import { placeResearch } from '@/lib/db/schema/place-research'

const record = z.record(z.string(), z.json())
const candidate = z.object({ id: z.string().regex(/^DJ-\d{3}$/), name: z.string().min(1),
  officialUrls: z.array(z.url()), location: z.object({ lon: z.number(), lat: z.number(), isEntrance: z.boolean() }).passthrough().nullable(),
  tourApiMatch: z.object({ matchKind: z.enum(['exact_name', 'alias_address', 'subsite_only', 'superset_only', 'no_match']),
    primary: z.object({ contentid: z.string(), contenttypeid: z.string() }).passthrough().nullable() }).passthrough(),
  observationIds: z.array(z.string()), continuousWheelchairAccess: z.literal('unverified_for_entire_place'),
}).passthrough()
const inputSchema = z.object({ schemaVersion: z.literal('bopok.research.v2'), researchDate: z.string(), places: z.array(candidate).length(108),
  observations: z.array(record).length(1707), sourceChecks: z.array(record).length(648),
  apiFields: z.array(record).length(2492), apiImages: z.array(record).length(949), quarantined: z.array(record).length(39),
}).passthrough()
export const hashResearch = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type Existing = { id: string; name: string; lng: number; lat: number }
export function planResearch(input: unknown, geoInput: unknown, existing: Existing[]) {
  const data = inputSchema.parse(input)
  const ids = new Set(data.places.map(place => place.id))
  if (ids.size !== 108) throw Error('후보 ID 중복: candidate.id')
  const obs = new Set(data.observations.map(item => String(item.observationId)))
  if (obs.size !== 1707) throw Error('observationId 중복')
  for (const place of data.places) for (const id of place.observationIds) if (!obs.has(id)) throw Error(`${place.id}.observationIds:${id}`)
  for (const key of ['observations', 'sourceChecks', 'apiFields', 'apiImages', 'quarantined'] as const) {
    for (const item of data[key]) if (!ids.has(String(item.placeId))) throw Error(`${key}.placeId:${item.placeId}`)
  }
  for (const place of data.places) {
    if (data.sourceChecks.filter(row => row.placeId === place.id).length !== 6) throw Error(`${place.id}.sourceChecks: 6행 필요`)
    if (place.location && (Math.abs(place.location.lon) > 180 || Math.abs(place.location.lat) > 90 || !Number.isFinite(place.location.lon + place.location.lat))) throw Error(`${place.id}.location: 좌표 범위`)
  }
  const geo = z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({
    type: z.literal('Feature'), id: z.union([z.string(), z.number()]), geometry: record, properties: record,
  }).passthrough()).length(4328) }).parse(geoInput)
  const featureIds = new Set(geo.features.map(feature => String(feature.id)))
  if (featureIds.size !== geo.features.length) throw Error('OSM id 중복')
  function coordinates(value: unknown): void {
    if (!Array.isArray(value)) throw Error('OSM.geometry.coordinates')
    if (typeof value[0] === 'number') { z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).parse(value); return }
    value.forEach(coordinates)
  }
  for (const feature of geo.features) {
    coordinates(feature.geometry.coordinates)
    const linked = z.array(z.string()).parse(feature.properties.placeIds)
    if (linked.some(id => !ids.has(id))) throw Error(`OSM ${feature.id}.placeIds`)
  }
  const namespace = `daejeon-20261103-${hashResearch(input).slice(0, 16)}`
  const canonical: Record<string, string> = { '741658': 'hanbat', '130551': 'art', '590097': 'leeungno' }
  const counts = new Map<string, number>()
  for (const p of data.places) if (p.tourApiMatch.primary) counts.set(p.tourApiMatch.primary.contentid, (counts.get(p.tourApiMatch.primary.contentid) ?? 0) + 1)
  const mapping = data.places.map(p => {
    const match = p.tourApiMatch
    const full = match.matchKind === 'exact_name' || match.matchKind === 'alias_address'
    const reason = !full ? `범위 보류: ${match.matchKind}` : !p.location ? '대표좌표 미확보' : counts.get(match.primary?.contentid ?? '')! > 1 ? '중첩 후보: 동일 콘텐츠를 공유하므로 통합 검토 필요' : null
    const contentId = match.primary?.contentid
    const intendedId = contentId ? canonical[contentId] ?? `tourapi-${match.primary!.contenttypeid}-${contentId}` : null
    const previous = existing.find(row => row.id === intendedId)
    const conflict = previous && previous.name.replace(/\s/g, '') !== p.name.replace(/\s/g, '') && match.matchKind !== 'alias_address'
    return { researchId: p.id, dbId: reason || conflict ? null : intendedId, status: reason || conflict ? 'pending' : previous ? 'linked' : 'new',
      reason: reason ?? (conflict ? '기존 ID의 이름 불일치: 수동 검토 필요' : previous ? '명시적 콘텐츠 ID 연결, 기존 값 보존' : '직접/별칭 매칭 대표점; 입구·현장 검증 아님'), matchKind: match.matchKind }
  })
  const rows: (typeof placeResearch.$inferInsert)[] = []
  const add = (entity: string, externalId: string, value: Record<string, unknown>, placeId: string | null = null) => rows.push({ namespace, entity, externalId, placeId, hash: hashResearch(value), data: value })
  const byId = new Map(mapping.map(item => [item.researchId, item]))
  for (const p of data.places) add('candidate', p.id, { original: p, mapping: byId.get(p.id) }, byId.get(p.id)?.dbId)
  for (const [key, value] of Object.entries(data)) {
    if (key === 'places') continue
    if (Array.isArray(value)) value.forEach((item, index) => {
      const object: Record<string, unknown> = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : { value: item }
      add(key, key === 'observations' || key === 'quarantined' ? String(object.observationId) : String(index), object,
        typeof object.placeId === 'string' ? byId.get(object.placeId)?.dbId : null)
    })
    else add('metadata', key, { value })
  }
  for (const feature of geo.features) add('osm', String(feature.id), feature)
  return { namespace, mapping, rows, places: data.places, report: { candidates: 108, mapping,
    added: mapping.filter(m => m.status === 'new').length, linked: mapping.filter(m => m.status === 'linked').length,
    pending: mapping.filter(m => m.status === 'pending').length, updated: 0, quarantined: 39, imagesPublished: 0,
    continuousAccessUnverified: 108, records: rows.length } }
}
export async function applyResearch(db: Db, plan: ReturnType<typeof planResearch>) {
  // 모든 충돌을 쓰기 전에 검사한다. 변경된 원문은 새 namespace로만 들어간다.
  const previous = await db.select().from(placeResearch).where(eq(placeResearch.namespace, plan.namespace))
  const hashes = new Map(previous.map(row => [`${row.entity}:${row.externalId}`, row.hash]))
  for (const row of plan.rows) if (hashes.has(`${row.entity}:${row.externalId}`) && hashes.get(`${row.entity}:${row.externalId}`) !== row.hash) throw Error(`기존 연구자료 충돌 ${row.entity}:${row.externalId}`)
  const wanted = plan.mapping.filter(item => item.dbId).map(item => item.dbId!)
  const existing = wanted.length ? await db.select().from(places).where(inArray(places.id, wanted)) : []
  const existingIds = new Set(existing.map(p => p.id))
  for (const map of plan.mapping) {
    const current = existing.find(p => p.id === map.dbId)
    const original = plan.places.find(p => p.id === map.researchId)!
    if (current && map.status === 'new' && current.name.replace(/\s/g, '') !== original.name.replace(/\s/g, '')) throw Error(`${map.researchId}: 기존 ID 이름 충돌, 쓰기 중단`)
  }
  let added = 0, recordsAdded = 0
  for (const map of plan.mapping) {
    if (!map.dbId || existingIds.has(map.dbId)) continue
    const p = plan.places.find(p => p.id === map.researchId)!
    const saved = await db.insert(places).values({ id: map.dbId, name: p.name, category: '관광지 · 현장 미검증', kind: 'attraction',
      styles: [], lng: p.location!.lon, lat: p.location!.lat,
      // 호환 불리언은 휴식 확정·실내 확정으로 채택하지 않는다. 원본 미확인은 별도 자료에 그대로 보존한다.
      seated: false, indoor: false, address: typeof p.address === 'string' ? p.address : undefined,
      source: p.officialUrls[0], checkedAt: '2026-11-03', confidence: 'B',
    }).onConflictDoNothing({ target: places.id }).returning({ id: places.id })
    added += saved.length
  }
  for (let i = 0; i < plan.rows.length; i += 100) {
    const saved = await db.insert(placeResearch).values(plan.rows.slice(i, i + 100)).onConflictDoNothing().returning({ id: placeResearch.externalId })
    recordsAdded += saved.length
  }
  return { added, updated: 0, recordsAdded, recordsUnchanged: plan.rows.length - recordsAdded }
}
export async function researchNotice(db: Db, placeId: string) {
  const rows = await db.select({ data: placeResearch.data }).from(placeResearch).where(and(eq(placeResearch.entity, 'candidate'), eq(placeResearch.placeId, placeId)))
  return rows.length ? { candidateCount: rows.length, continuousWheelchairAccess: 'unverified' as const,
    notice: '공개자료 조사 결과예요. 대표점은 입구가 아니며, 전체 동선·계단·휴식시설은 현장에서 확인하지 않았어요. 보류 근거와 주변 지도 객체는 판정에 사용하지 않아요.' } : undefined
}
