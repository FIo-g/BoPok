import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
