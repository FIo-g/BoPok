import 'server-only'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { PlaceDetailSchema, PlaceIdInputSchema, PlaceSummarySchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { places } from '@/lib/db/schema/places'
import { toPlaceSummary } from './index'

// 시범 파일은 장소 기본 칸과 함께 장소 안 지점·구간·코스를 담을 수 있다 (한밭수목원 동원 코스).
// 이 함수는 기본 칸만 넣고, 지점·구간은 fillPlaceInside가 빈 장소에만 넣는다. 방문 시간은 여전히 허용하지 않는다.
export const PilotPlaceSchema = PlaceDetailSchema.extend({
  id: PlaceIdInputSchema,
  source: z.url(), checkedAt: z.iso.date(),
  visitMin: z.undefined().optional(),
}).strict()

export async function insertPilotPlaces(db: Db, input: unknown) {
  const entries = z.array(PilotPlaceSchema).min(1).max(100).parse(input)
  const ids = entries.map(entry => entry.id)
  if (new Set(ids).size !== ids.length) throw new Error('시범 장소 ID가 중복되었습니다.')
  const existing = await db.select().from(places).where(inArray(places.id, ids))
  const existingById = new Map(existing.map(row => [row.id, toPlaceSummary(row)]))
  for (const entry of entries) {
    const summary = PlaceSummarySchema.parse(entry)
    const previous = existingById.get(entry.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(summary)) {
      throw new Error(`기존 장소 ${entry.id}의 내용이 달라 덮어쓰지 않습니다.`)
    }
  }
  let inserted = 0
  for (const entry of entries) {
    const result = await db.insert(places).values({
      id: entry.id, name: entry.name, category: entry.category, styles: entry.styles,
      lng: entry.coord[0], lat: entry.coord[1], seated: entry.seated, indoor: entry.indoor,
      address: entry.address, phone: entry.phone, homepage: entry.homepage,
      source: entry.source, checkedAt: entry.checkedAt, confidence: entry.confidence,
    }).onConflictDoNothing({ target: places.id }).returning({ id: places.id })
    inserted += result.length
  }
  return { ids, inserted, unchanged: entries.length - inserted }
}
