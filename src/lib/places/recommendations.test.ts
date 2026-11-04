import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { importPreparedCatalog, prepareFoodCatalog } from './catalog-import'
import { recommendServicePlaces } from './recommendations'
import { indexPlaceEmbeddings } from './embeddings'
import { straightLineDistanceM, straightLineDetourM } from '@/lib/geo/straight-line'

const client = new PGlite({ dataDir: 'memory://', extensions: { vector } })
const db = drizzle(client, { schema })
const item = (id: number, name: string, kind = '한식', lng = '127.38') => prepareFoodCatalog({
  raw: { REST_ID: id, REST_NM: name, TOB_INFO: kind, ADDR: '대전 가상 주소', LOT: lng, LAT: '36.35',
    MENU_KORN_NM: [name], MENU_AMT: ['8,000원'] }, retrievedAt: '2026-11-03T00:00:00.000Z',
})
const firstVector = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0)
const secondVector = Array.from({ length: 1024 }, (_, i) => i === 1 ? 1 : 0)
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await client.exec(readFileSync('scripts/data/sql/place-embeddings.sql', 'utf8'))
}, 60000)
beforeEach(async () => { await db.execute(sql`truncate places cascade`) })
afterAll(async () => { await client.close() })

describe('실제 pgvector와 후보 추천', () => {
  it('종류별로 색인하며 완료한 종류만 의미 검색을 켠다', async () => {
    await importPreparedCatalog(db, [item(1, '가상 식당'), item(2, '가상 카페', '카페')])
    const embed = vi.fn(async (texts: string[]) => texts.map(() => firstVector))
    expect(await indexPlaceEmbeddings(db, { kind: 'cafe', embed })).toMatchObject({ indexed: 1, requests: 1 })
    const options = { db, embedQuery: async () => firstVector }
    expect((await recommendServicePlaces({ kind: 'cafe', query: '조용히 쉬기' }, options)).method).toBe('vector')
    expect((await recommendServicePlaces({ kind: 'restaurant', query: '식당' }, options)).method).toBe('keyword')
    expect(await indexPlaceEmbeddings(db, { kind: 'cafe', embed })).toMatchObject({ indexed: 0, requests: 0 })
    expect(embed).toHaveBeenCalledTimes(1)
  })
  it('종류가 비어 있는 기존 장소도 관광지 색인에 포함한다', async () => {
    await importPreparedCatalog(db, [item(1, '기존 장소')])
    await db.execute(sql`update places set kind = null where id = 'daejeon-food-1'`)
    expect(await indexPlaceEmbeddings(db, { kind: 'attraction', embed: async texts => texts.map(() => firstVector) }))
      .toMatchObject({ indexed: 1, requests: 1 })
    expect((await recommendServicePlaces({ kind: 'attraction', query: '관광' }, { db, embedQuery: async () => firstVector })).method).toBe('vector')
  })
  it('계단 피하기는 벡터·키워드의 개수 제한 전에 적용하며 미기록을 안전으로 확정하지 않는다', async () => {
    await importPreparedCatalog(db, [item(1, '국수 계단 기록 있음'), item(2, '국수 내부 미기록')])
    const placeId = 'daejeon-food-1'
    await db.insert(schema.placeNodes).values([
      { placeId, id: 'a', kind: 'entrance', name: '가상 입구', lng: 127.38, lat: 36.35 },
      { placeId, id: 'b', kind: 'sight', name: '가상 볼거리', lng: 127.381, lat: 36.35 },
    ])
    await db.insert(schema.placeSegments).values({
      placeId, id: 'steps', fromNodeId: 'a', toNodeId: 'b', order: 0, distanceM: 10,
      path: [[127.38, 36.35], [127.381, 36.35]], stairsStatus: 'present', stairsCount: 12,
      slope: false, optional: false, source: '테스트 가상 계단', checkedAt: '2026-11-03', confidence: 'C',
    })
    await indexPlaceEmbeddings(db, { embed: async texts => texts.map(text => text.includes('기록 있음') ? firstVector : secondVector) })
    const options = { db, embedQuery: async () => firstVector }
    const request = { kind: 'restaurant', query: '국수', limit: 1 }
    expect((await recommendServicePlaces(request, options)).items[0].place.id).toBe('daejeon-food-1')
    const avoided = await recommendServicePlaces({ ...request, avoidStairs: true }, options)
    expect(avoided.method).toBe('vector')
    expect(avoided.items.map(item => item.place.id)).toEqual(['daejeon-food-2'])
    const fallback = await recommendServicePlaces({ ...request, avoidStairs: true }, {
      db, embedQuery: async () => { throw Error('가상 장애') },
    })
    expect(fallback.method).toBe('keyword')
    expect(fallback.items.map(item => item.place.id)).toEqual(['daejeon-food-2'])
    expect((await recommendServicePlaces({ ...request, avoidStairs: true, limit: 2 }, options)).items.map(item => item.place.id))
      .toEqual(['daejeon-food-2', 'daejeon-food-1'])
  })

  it('같은 종류를 SQL로 거르고 가까운 의미 순으로 돌려준다', async () => {
    await importPreparedCatalog(db, [item(1, '가상 국수'), item(2, '가상 밥집'), item(3, '가상 커피', '카페')])
    let calls = 0
    const result = await indexPlaceEmbeddings(db, { embed: async texts => {
      calls++
      return texts.map(text => text.includes('밥집') ? secondVector : firstVector)
    } })
    expect(result.indexed).toBe(3)
    const recommendations = await recommendServicePlaces({ kind: 'restaurant', query: '따뜻한 면 요리' }, {
      db, embedQuery: async () => firstVector,
    })
    expect(recommendations.method).toBe('vector')
    expect(recommendations.items.map(entry => entry.place.id)).toEqual(['daejeon-food-1', 'daejeon-food-2'])
    expect(recommendations.routeCheckRequired).toBe(true)
    expect(await indexPlaceEmbeddings(db, { embed: async () => { throw new Error('같은 원문을 재호출하면 안 됨') } }))
      .toMatchObject({ indexed: 0, requests: 0 })
    expect(calls).toBe(1)
  })

  it('일부만 색인된 종류는 벡터 검색과 질의 임베딩을 건너뛰고 키워드로 답한다', async () => {
    await importPreparedCatalog(db, [item(1, '가상 국수')])
    await indexPlaceEmbeddings(db, { embed: async texts => texts.map(() => firstVector) })
    await importPreparedCatalog(db, [item(2, '가상 밥집')])
    const embedQuery = vi.fn(async () => firstVector)
    const partial = await recommendServicePlaces({ kind: 'restaurant', query: '가상' }, { db, embedQuery })
    expect(partial.method).toBe('keyword')
    expect(embedQuery).not.toHaveBeenCalled()
    await indexPlaceEmbeddings(db, { embed: async texts => texts.map(() => secondVector) })
    const full = await recommendServicePlaces({ kind: 'restaurant', query: '가상' }, { db, embedQuery })
    expect(full.method).toBe('vector')
    expect(embedQuery).toHaveBeenCalledOnce()
  })

  it('벡터 생성이 실패하면 실제 키워드 검색임을 표시하고 다른 메뉴를 지어내지 않는다', async () => {
    await importPreparedCatalog(db, [item(1, '가상 국수'), item(2, '가상 밥집')])
    const result = await recommendServicePlaces({ kind: 'restaurant', query: '국수' }, { db, embedQuery: async () => { throw new Error('가상 실패') } })
    expect(result.method).toBe('keyword')
    expect(result.items.map(item => item.place.id)).toEqual(['daejeon-food-1'])
  })

  it('가까운 식당과 경로 우회가 작은 후보를 찾되 실제 이동 시간은 만들지 않는다', async () => {
    await importPreparedCatalog(db, [item(1, '먼 가상 식당', '한식', '127.40'), item(2, '가까운 가상 식당', '한식', '127.38')])
    const result = await recommendServicePlaces({ kind: 'restaurant', near: [127.38, 36.35] }, { db })
    expect(result.items[0].place.id).toBe('daejeon-food-2')
    expect(result.items[0].distanceM).toBe(0)
    expect(result.items[0]).not.toHaveProperty('durationMin')
    const onRoute = await recommendServicePlaces({ kind: 'restaurant', route: [[127.37, 36.35], [127.39, 36.35]] }, { db })
    expect(onRoute.items[0].place.id).toBe('daejeon-food-2')
  })

  it('직선거리 계산은 같은 점 0m, 적도 1도 약 111195m이며 우회는 음수가 아니다', () => {
    expect(straightLineDistanceM([0, 0], [0, 0])).toBe(0)
    expect(straightLineDistanceM([0, 0], [1, 0])).toBe(111195)
    expect(straightLineDetourM([0, 0], [0.5, 0], [1, 0])).toBeGreaterThanOrEqual(0)
  })
})
