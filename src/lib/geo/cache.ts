import 'server-only'
import { inArray } from 'drizzle-orm'
import type { Leg } from '@/lib/contracts'
import { getDb, type Db } from '@/lib/db/client'
import { legCache } from '@/lib/db/schema/places'
import { WalkingLegSchema } from './validation'

export const LEG_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface LegCacheStore {
  read(keys: string[]): Promise<Map<string, Leg>>
  save(leg: Leg): Promise<void>
}

export function createLegCache(database?: Db): LegCacheStore {
  return {
    async read(keys) {
      if (!keys.length) return new Map()
      const rows = await (database ?? getDb()).select().from(legCache).where(inArray(legCache.key, keys))
      const found = new Map<string, Leg>()
      for (const row of rows) {
        // 공식 약관의 24시간 사용 제한을 지킨다. 만료 행은 삭제하지 않고 재사용만 막는다.
        const ageMs = Date.now() - row.fetchedAt.getTime()
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= LEG_CACHE_TTL_MS) continue
        const parsed = WalkingLegSchema.safeParse({
          ...row, stairsCount: row.stairsCount ?? undefined,
          durationMin: row.durationMin ?? undefined, fareKrw: row.fareKrw ?? undefined,
        })
        if (parsed.success) found.set(row.key, parsed.data)
      }
      return found
    },
    async save(leg) {
      const value = WalkingLegSchema.parse(leg)
      const entry = {
        key: value.key, mode: value.mode, distanceM: value.distanceM, path: value.path,
        source: value.source, checkedAt: value.checkedAt, confidence: value.confidence,
        stairsStatus: value.stairsStatus, stairsCount: null, durationMin: null, fareKrw: null,
        fetchedAt: new Date(),
      }
      await (database ?? getDb()).insert(legCache).values(entry)
        .onConflictDoUpdate({ target: legCache.key, set: entry })
    },
  }
}
