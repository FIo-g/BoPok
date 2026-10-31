import 'server-only'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { PlaceDetailSchema, PlaceIdInputSchema, PlaceSummarySchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import { places } from '@/lib/db/schema/places'
import { toPlaceSummary } from './index'

// 이번 시범 적재에는 조사하지 않은 내부 지점·구간·방문 시간을 허용하지 않는다.
export const PilotPlaceSchema = PlaceDetailSchema.extend({
  id: PlaceIdInputSchema,
  source: z.url(), checkedAt: z.iso.date(),
  nodes: z.array(z.never()).length(0), segments: z.array(z.never()).length(0),
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
