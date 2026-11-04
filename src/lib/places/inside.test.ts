import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PlaceDetailSchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { placeNodes, placeSegments } from '@/lib/db/schema/places'
import { getPlaceDetails } from './index'
import { fillPlaceInside } from './inside'
import { insertPilotPlaces, PilotPlaceSchema } from './seed'

// 메모리 PGlite만 쓴다. 공용 DB에는 연결하지 않는다.
const client = new PGlite('memory://')
const db = drizzle(client, { schema }) as unknown as Db
const readPlace = (id: string) => PilotPlaceSchema.parse(
  JSON.parse(readFileSync(new URL(`../../../data/places/${id}.json`, import.meta.url), 'utf8')),
)
const pilots = ['hanbat', 'art', 'leeungno'].map(readPlace)
const hanbat = pilots[0]

beforeAll(async () => { await migrate(db as never, { migrationsFolder: './drizzle' }) }, 30000)
beforeEach(async () => {
  await db.execute(sql`truncate table places cascade`)
  await insertPilotPlaces(db, pilots)
})
afterAll(async () => { await client.close() })

const countInside = async (placeId: string) => {
  const nodes = await db.select().from(placeNodes).where(eq(placeNodes.placeId, placeId))
  const segments = await db.select().from(placeSegments).where(eq(placeSegments.placeId, placeId))
  return { nodes: nodes.length, segments: segments.length }
}

describe('장소 안 지점·구간 적재', () => {
  it('지점과 구간이 없는 장소에 설계 파일의 내용을 넣고 상세 계약으로 읽힌다', async () => {
    expect(await countInside('hanbat')).toEqual({ nodes: 0, segments: 0 })
    const result = await fillPlaceInside(db, hanbat)
    expect(result).toEqual({ placeId: 'hanbat', nodes: hanbat.nodes.length, segments: hanbat.segments.length })

    const [detail] = await getPlaceDetails(['hanbat'], db)
    expect(PlaceDetailSchema.parse(detail).nodes).toHaveLength(hanbat.nodes.length)
    expect(detail.segments).toHaveLength(hanbat.segments.length)
    const detour = detail.segments.find(segment => segment.id === 'hb-t1d')
    expect(detour).toMatchObject({ detourOf: 'hb-t1', stairsStatus: 'unknown' })
    expect(detail.segments.find(segment => segment.id === 'hb-t1')).toMatchObject({ stairsStatus: 'present', confidence: 'B' })
    expect(detail.nodes.find(node => node.id === 'hb-shelter')).toMatchObject({ restType: 'outdoor', kind: 'rest' })
  })

  it('이미 지점이나 구간이 하나라도 있으면 아무것도 하지 않고 건너뛴다', async () => {
    await fillPlaceInside(db, hanbat)
    const before = await getPlaceDetails(['hanbat'], db)
    expect(await fillPlaceInside(db, hanbat)).toEqual({ placeId: 'hanbat', skipped: 'already_has_inside' })
    expect(await getPlaceDetails(['hanbat'], db)).toEqual(before)
  })

  it('지점만 있고 구간이 없어도 건너뛰어 기존 데이터를 덮지 않는다', async () => {
    await db.insert(placeNodes).values({ id: 'hb-p', placeId: 'hanbat', kind: 'parking', name: '기존 주차장', restType: null, lng: 127.1, lat: 36.1 })
    expect(await fillPlaceInside(db, hanbat)).toEqual({ placeId: 'hanbat', skipped: 'already_has_inside' })
    expect(await countInside('hanbat')).toEqual({ nodes: 1, segments: 0 })
  })

  it('다른 장소의 내부 데이터는 건드리지 않는다', async () => {
    await fillPlaceInside(db, hanbat)
    expect(await countInside('art')).toEqual({ nodes: 0, segments: 0 })
    expect(await countInside('leeungno')).toEqual({ nodes: 0, segments: 0 })
    await fillPlaceInside(db, readPlace('art'))
    expect(await countInside('hanbat')).toEqual({ nodes: hanbat.nodes.length, segments: hanbat.segments.length })
  })

  it('다시 실행해도 결과와 행 수가 그대로다', async () => {
    await fillPlaceInside(db, hanbat)
    const first = await getPlaceDetails(['hanbat'], db)
    await fillPlaceInside(db, hanbat)
    await fillPlaceInside(db, hanbat)
    expect(await getPlaceDetails(['hanbat'], db)).toEqual(first)
    expect(await countInside('hanbat')).toEqual({ nodes: hanbat.nodes.length, segments: hanbat.segments.length })
  })

  it('DB에 없는 장소는 넣지 않고 실패한다', async () => {
    await expect(fillPlaceInside(db, { ...hanbat, id: 'missing' })).rejects.toThrow('DB에 없어')
    expect(await countInside('missing')).toEqual({ nodes: 0, segments: 0 })
  })

  it('구간이 없는 지점을 가리키면 지점까지 되돌리고 기존 장소는 그대로 둔다', async () => {
    const broken = {
      ...hanbat,
      segments: hanbat.segments.map(segment => (segment.id === 'hb-t9' ? { ...segment, toNodeId: 'no-such-node' } : segment)),
    }
    await expect(fillPlaceInside(db, broken)).rejects.toThrow()
    expect(await countInside('hanbat')).toEqual({ nodes: 0, segments: 0 })
    expect((await getPlaceDetails(['hanbat'], db))[0]).toMatchObject({ nodes: [], segments: [] })
    // 되돌린 뒤에는 올바른 데이터로 다시 채울 수 있다.
    expect(await fillPlaceInside(db, hanbat)).toMatchObject({ nodes: hanbat.nodes.length })
  })

  it('출처나 확인 날짜가 없는 구간은 넣지 않는다', async () => {
    const missingSource = { ...hanbat, segments: hanbat.segments.map(segment => ({ ...segment, source: undefined })) }
    await expect(fillPlaceInside(db, missingSource)).rejects.toThrow('출처')
    expect(await countInside('hanbat')).toEqual({ nodes: 0, segments: 0 })
  })
})
