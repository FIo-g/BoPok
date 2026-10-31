import { PGlite } from '@electric-sql/pglite'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { LegSchema, legKey, PlaceDetailSchema, type Coord, type LegRequest } from '../../contracts'
import * as schema from './index'
import { legCache, placeNodes, places, placeSegments } from './index'

const client = new PGlite('memory://')
const db = drizzle(client, { schema })
const provenance = { source: '테스트용 가상 자료', checkedAt: '2026-10-30', confidence: 'B' as const }
const path: Coord[] = [[127.38, 36.37], [127.381, 36.371]]
const place = {
  id: 'test-place', name: '가상 장소', category: 'test', styles: ['휴식'],
  lng: path[0][0], lat: path[0][1], seated: false, indoor: false, ...provenance,
}
const segment = {
  id: 'route', placeId: place.id, fromNodeId: 'entrance', toNodeId: 'sight',
  order: 0, distanceM: 150.5, path, stairsStatus: 'unknown' as const,
  slope: false, optional: false, ...provenance,
}
const request: LegRequest = { from: { coord: path[0] }, to: { coord: path[1] }, mode: 'walk' }
const cachedLeg = {
  key: legKey(request), mode: request.mode, distanceM: 150.5, path,
  stairsStatus: 'unknown' as const, ...provenance,
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
}, 30000)

afterAll(async () => { await client.close() })

beforeEach(async () => {
  await db.execute(sql`truncate table leg_cache, places cascade`)
  await db.insert(places).values(place)
  await db.insert(placeNodes).values([
    { id: 'entrance', placeId: place.id, kind: 'entrance', name: '입구', lng: path[0][0], lat: path[0][1] },
    { id: 'sight', placeId: place.id, kind: 'sight', name: '볼거리', lng: path[1][0], lat: path[1][1] },
  ])
})

describe('장소 마이그레이션과 계약 호환', () => {
  it('통합 스키마로 등록한 네 테이블을 관계형 조회 API로 읽을 수 있다', async () => {
    await db.insert(placeSegments).values(segment)
    await db.insert(legCache).values(cachedLeg)
    expect(await db.query.places.findFirst({ where: eq(places.id, place.id) })).toMatchObject(place)
    expect(await db.query.placeNodes.findMany()).toHaveLength(2)
    expect(await db.query.placeSegments.findFirst()).toMatchObject(segment)
    expect(await db.query.legCache.findFirst()).toMatchObject(cachedLeg)
  })

  it('실제 마이그레이션으로 네 테이블을 만들고 재적용해도 저장 자료를 유지한다', async () => {
    const result = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    )
    expect(result.rows.map(row => row.table_name)).toEqual(expect.arrayContaining(['leg_cache', 'place_nodes', 'place_segments', 'places']))
    await migrate(db, { migrationsFolder: './drizzle' })
    expect(await db.select().from(places)).toHaveLength(1)
  })

  it('지점·구간·우회로를 저장하고 PlaceDetail 계약으로 되돌릴 수 있다', async () => {
    await db.insert(placeSegments).values({ ...segment, stairsStatus: 'present', stairsCount: 24 })
    await db.insert(placeSegments).values({
      ...segment, id: 'detour', detourOf: segment.id, order: 1,
      stairsStatus: 'confirmed_none', distanceM: 230,
    })
    const [row] = await db.select().from(places)
    const nodes = await db.select().from(placeNodes)
    const segments = await db.select().from(placeSegments).orderBy(placeSegments.order)
    const detail = PlaceDetailSchema.parse({
      ...row, coord: [row.lng, row.lat], visitMin: row.visitMin ?? undefined,
      address: row.address ?? undefined, phone: row.phone ?? undefined, homepage: row.homepage ?? undefined,
      nodes: nodes.map(node => ({ ...node, coord: [node.lng, node.lat] })),
      segments: segments.map(item => ({ ...item, stairsCount: item.stairsCount ?? undefined, detourOf: item.detourOf ?? undefined })),
    })
    expect(detail.nodes).toHaveLength(2)
    expect(detail.segments[0]).toMatchObject({ distanceM: 150.5, stairsStatus: 'present', stairsCount: 24, path })
    expect(detail.segments[1]).toMatchObject({ detourOf: 'route', stairsStatus: 'confirmed_none' })
  })

  it('확인하지 않은 계단 상태와 모르는 칸 수를 그대로 저장한다', async () => {
    await db.insert(placeSegments).values(segment)
    const [row] = await db.select().from(placeSegments)
    expect(row).toMatchObject({ stairsStatus: 'unknown', stairsCount: null, detourOf: null })
  })

  it('캐시는 공용 키로 방향과 이동수단을 구분하고 시간·요금을 보존한다', async () => {
    const reverse = { ...request, from: request.to, to: request.from }
    const taxi = { ...request, mode: 'taxi' as const }
    await db.insert(legCache).values([
      cachedLeg,
      { ...cachedLeg, key: legKey(reverse) },
      { ...cachedLeg, key: legKey(taxi), mode: taxi.mode, durationMin: 4.5, fareKrw: 4500 },
    ])
    const rows = await db.select().from(legCache)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const result = LegSchema.parse({
        ...row, durationMin: row.durationMin ?? undefined,
        stairsCount: row.stairsCount ?? undefined, fareKrw: row.fareKrw ?? undefined,
      })
      expect(result.stairsStatus).toBe('unknown')
      expect(row.fetchedAt).toBeInstanceOf(Date)
    }
    expect(rows.find(row => row.mode === 'taxi')).toMatchObject({ durationMin: 4.5, fareKrw: 4500 })
    await expect(db.insert(legCache).values(cachedLeg)).rejects.toMatchObject({ cause: { code: '23505' } })
  })
})

describe('장소 관계 무결성', () => {
  it('서로 다른 장소에서 같은 지점 ID를 허용하고 같은 장소에서는 중복을 막는다', async () => {
    await db.insert(places).values({ ...place, id: 'other-place' })
    const node = { id: 'entrance', placeId: 'other-place', kind: 'entrance' as const, name: '다른 입구', lng: 127.38, lat: 36.37 }
    await db.insert(placeNodes).values(node)
    await expect(db.insert(placeNodes).values(node)).rejects.toMatchObject({ cause: { code: '23505' } })
  })

  it('없는 장소의 지점과 다른 장소의 지점으로 이어지는 구간을 막는다', async () => {
    await expect(db.insert(placeNodes).values({
      id: 'orphan', placeId: 'missing', kind: 'entrance', name: '입구', lng: 127, lat: 36,
    })).rejects.toMatchObject({ cause: { code: '23503' } })
    await db.insert(places).values({ ...place, id: 'other-place' })
    await db.insert(placeNodes).values({
      id: 'other-only', placeId: 'other-place', kind: 'sight', name: '다른 볼거리', lng: 127, lat: 36,
    })
    await expect(db.insert(placeSegments).values({ ...segment, toNodeId: 'other-only' }))
      .rejects.toMatchObject({ cause: { code: '23503' } })
  })

  it('없는 구간의 우회로와 자기 자신을 가리키는 우회로를 막는다', async () => {
    await expect(db.insert(placeSegments).values({ ...segment, detourOf: 'missing' }))
      .rejects.toMatchObject({ cause: { code: '23503' } })
    await expect(db.insert(placeSegments).values({ ...segment, detourOf: segment.id }))
      .rejects.toMatchObject({ cause: { code: '23514' } })
  })

  it('장소 삭제 시 소속 지점·구간이 남지 않는다', async () => {
    await db.insert(placeSegments).values(segment)
    await db.delete(places).where(eq(places.id, place.id))
    expect(await db.select().from(placeNodes)).toEqual([])
    expect(await db.select().from(placeSegments)).toEqual([])
  })
})

describe('저장 데이터 제약', () => {
  it.each([
    { distanceM: -1 }, { distanceM: Infinity }, { distanceM: NaN },
    { order: -1 }, { stairsCount: -1 }, { path: [path[0]] },
    { source: '' }, { checkedAt: ' ' },
  ])('잘못된 구간 값을 거부한다: %j', async changes => {
    await expect(db.insert(placeSegments).values({ ...segment, ...changes }))
      .rejects.toMatchObject({ cause: { code: '23514' } })
  })

  it.each([{ lng: 181 }, { lat: 91 }, { visitMin: -1 }, { source: ' ' }, { checkedAt: '' }])(
    '잘못된 장소 값을 거부한다: %j', async changes => {
      await expect(db.insert(places).values({ ...place, id: 'invalid-place', ...changes }))
        .rejects.toMatchObject({ cause: { code: '23514' } })
    },
  )

  it.each([{ distanceM: -1 }, { durationMin: -1 }, { fareKrw: -1 }, { stairsCount: -1 }])(
    '잘못된 경로 캐시 값을 거부한다: %j', async changes => {
      await expect(db.insert(legCache).values({ ...cachedLeg, ...changes }))
        .rejects.toMatchObject({ cause: { code: '23514' } })
    },
  )

  it('출처·확인 날짜·신뢰 등급 누락과 잘못된 계단 상태를 DB에서도 거부한다', async () => {
    await db.insert(placeSegments).values(segment)
    await db.insert(legCache).values(cachedLeg)
    for (const table of ['places', 'place_segments', 'leg_cache']) {
      for (const column of ['source', 'checked_at', 'confidence']) {
        await expect(db.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = null`))
          .rejects.toMatchObject({ cause: { code: '23502' } })
      }
    }
    await expect(db.execute(sql`update place_segments set stairs_status = 'none'`))
      .rejects.toMatchObject({ cause: { code: '22P02' } })
  })
})
