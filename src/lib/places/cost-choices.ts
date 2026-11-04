import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { PlaceCostChoicesRequestSchema, PlaceCostChoicesResponseSchema, type PlaceCostOption } from '@/lib/contracts'
import { getDb, type Db } from '@/lib/db/client'
import { placeCatalog, places } from '@/lib/db/schema/places'
import { hasPlaceCatalog } from './index'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function getPlaceCostChoices(input: unknown, database?: Db) {
  const { ids } = PlaceCostChoicesRequestSchema.parse(input)
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const db = database ?? getDb()
  if (!await hasPlaceCatalog(db)) return unique.map(placeId => ({ placeId, options: [], notes: ['가격 자료가 아직 등록되지 않았어요.'] }))
  const rows = await db.select({ id: places.id, source: places.source, checkedAt: places.checkedAt,
    confidence: places.confidence, data: placeCatalog.data, menus: placeCatalog.menus })
    .from(places).innerJoin(placeCatalog, eq(places.id, placeCatalog.placeId)).where(inArray(places.id, unique))
  const found = new Map(rows.map(row => [row.id, row]))
  return PlaceCostChoicesResponseSchema.parse(unique.map(placeId => {
    const row = found.get(placeId)
    if (!row) return { placeId, options: [], notes: ['등록된 가격 정보가 없어요.'] }
    const source = { source: typeof row.data.source === 'string' ? row.data.source : row.source,
      checkedAt: typeof row.data.checkedAt === 'string' ? row.data.checkedAt : row.checkedAt,
      confidence: row.data.confidence === 'A' || row.data.confidence === 'B' || row.data.confidence === 'C' ? row.data.confidence : row.confidence }
    const options: PlaceCostOption[] = row.menus.flatMap((menu, index) => menu.priceKrw === undefined ? [] : [{
      id: `menu-${index}`, label: menu.name, kind: 'meal' as const, amountKrw: menu.priceKrw,
      unit: 'unspecified' as const, ...source,
    }])
    const rooms = object(row.data.lodging).rooms
    if (Array.isArray(rooms)) rooms.forEach((value, roomIndex) => {
      const room = object(value)
      const rates = object(room.publishedRates)
      const labels = { offSeasonWeekday: '비수기 주중', offSeasonWeekend: '비수기 주말', peakSeasonWeekday: '성수기 주중', peakSeasonWeekend: '성수기 주말' }
      for (const [key, label] of Object.entries(labels)) {
        const amount = object(rates[key]).amountKrw
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) continue
        options.push({ id: `room-${roomIndex}-${key}`, label: `${typeof room.name === 'string' ? room.name : '객실'} · ${label} · 1박 공시 최저가`,
          kind: 'lodging', amountKrw: amount, unit: 'shared', ...source })
      }
    })
    const intro = object(row.data.raw).intro
    const feeNotes: string[] = []
    if (Array.isArray(intro)) {
      for (const item of intro) {
        const text = object(item).usefee ?? object(item).usefeeinfo
        if (typeof text === 'string' && text.trim()) feeNotes.push(`이용요금 원문: ${text.replace(/<[^>]*>/g, ' ').trim().slice(0, 600)}`)
        if (typeof text === 'string' && /^(?:입장료\s*[:：]?\s*)?무료$/.test(text.trim())) {
          options.push({ id: 'admission-free', label: '입장료 무료 (API 제공)', kind: 'admission', amountKrw: 0, unit: 'per_person', ...source })
          break
        }
      }
    }
    return { placeId, options, notes: [
      ...feeNotes,
      ...(row.menus.length ? ['메뉴 가격은 1인분·세트 등 수량 단위를 확인한 뒤 선택해 주세요.'] : []),
      ...(Array.isArray(rooms) && rooms.length ? ['숙박은 객실당 1박 공시 가격이며 실시간 예약가가 아니에요.'] : []),
      ...(!options.length ? ['확인된 가격이 없어요. 직접 입력하거나 미확인으로 남겨 주세요.'] : []),
    ] }
  }))
}
