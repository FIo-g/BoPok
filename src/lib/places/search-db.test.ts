// 장소 검색 함수 검사 — 실제 마이그레이션을 적용한 메모리 PGlite로 확인한다. 외부 API·디스크 DB는 열지 않는다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PlaceSummaryListSchema, PlaceSummarySchema, type StairsStatus } from '@/lib/contracts'
import * as schema from '@/lib/db/schema'
import { placeNodes, placeSegments } from '@/lib/db/schema/places'
import { matchPlaceByName, searchCandidates } from './search'
import { insertPilotPlaces, PilotPlaceSchema } from './seed'
import type { PlaceCandidateQuery } from './validation'

const client = new PGlite('memory://')
const db = drizzle(client, { schema })
const pilots = ['hanbat', 'art', 'leeungno'].map(id => PilotPlaceSchema.parse(
  JSON.parse(readFileSync(new URL(`../../../data/places/${id}.json`, import.meta.url), 'utf8')),
))

beforeAll(async () => { await migrate(db, { migrationsFolder: './drizzle' }) }, 30000)
beforeEach(async () => {
  // 이 테스트가 새로 만든 memory:// 안에서만 초기화한다. 디스크 DB는 열지 않는다.
  await db.execute(sql`truncate table places cascade`)
  await insertPilotPlaces(db, pilots)
})
afterAll(async () => { await client.close() })

function query(overrides: Partial<PlaceCandidateQuery> = {}): PlaceCandidateQuery {
  return { styles: [], transport: 'car', avoidStairs: false, limit: 30, ...overrides }
}
const ids = (rows: { id: string }[]) => rows.map(row => row.id)

// 시험용 가상 구간. 장소마다 입구→볼거리 구간을 주어진 계단 상태대로 넣는다.
async function addSegments(placeId: string, statuses: StairsStatus[]) {
  await db.insert(placeNodes).values([
    { id: 'entrance', placeId, kind: 'entrance', name: '가상 입구', lng: 127.38, lat: 36.36 },
    { id: 'sight', placeId, kind: 'sight', name: '가상 볼거리', lng: 127.381, lat: 36.361 },
  ])
  const rows = statuses.map((stairsStatus, index) => ({
    id: `seg${index}`, placeId, fromNodeId: 'entrance', toNodeId: 'sight', order: index, distanceM: 10,
    path: [[127.38, 36.36], [127.381, 36.361]] as [number, number][],
    stairsStatus, stairsCount: stairsStatus === 'present' ? 12 : null, slope: false, optional: false,
    source: '테스트용 가상 구간', checkedAt: '2026-10-31', confidence: 'C' as const,
  }))
  await db.insert(placeSegments).values(rows)
}

describe('searchCandidates', () => {
  it('스타일이 맞는 곳을 앞에 두고 나머지도 뒤에 붙인다', async () => {
    expect(ids(await searchCandidates(query({ styles: ['자연·산책'] }), db))).toEqual(['hanbat', 'art', 'leeungno'])
    expect(ids(await searchCandidates(query({ styles: ['문화·역사'] }), db))).toEqual(['art', 'leeungno', 'hanbat'])
  })

  it('장소 DB의 요약만 돌려주고 지점·구간·미조사 시간은 싣지 않는다', async () => {
    const rows = await searchCandidates(query(), db)
    expect(PlaceSummaryListSchema.parse(rows)).toHaveLength(3)
    for (const row of rows) {
      expect(row.source).toMatch(/^https:\/\//)
      expect(row).not.toHaveProperty('nodes')
      expect(row).not.toHaveProperty('segments')
      // toPlaceSummary가 키를 undefined로 두므로 값만 본다(JSON 응답에서는 키가 사라진다).
      expect(row.visitMin).toBeUndefined()
    }
  })

  it('DB에 없는 스타일만 골라도 후보가 비지 않는다', async () => {
    expect(await searchCandidates(query({ styles: ['맛집·음식'] }), db)).toHaveLength(3)
  })

  it('스타일 앞뒤 공백은 무시한다', async () => {
    expect(ids(await searchCandidates(query({ styles: [' 자연·산책 '] }), db))).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('limit만큼만 자른다 (0이면 빈 목록)', async () => {
    expect(ids(await searchCandidates(query({ styles: ['자연·산책'], limit: 2 }), db))).toEqual(['hanbat', 'art'])
    expect(await searchCandidates(query({ limit: 0 }), db)).toEqual([])
  })

  it('계단 피하기면 계단이 present인 장소를 뒤로 보낸다', async () => {
    await addSegments('hanbat', ['present'])
    expect(ids(await searchCandidates(query({ styles: ['자연·산책'], avoidStairs: true }), db))).toEqual(['art', 'leeungno', 'hanbat'])
  })

  it('계단 피하기가 아니면 계단이 있어도 순서를 바꾸지 않는다', async () => {
    await addSegments('hanbat', ['present'])
    expect(ids(await searchCandidates(query({ styles: ['자연·산책'] }), db))).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('present와 다른 상태가 섞여 있으면 present로 본다', async () => {
    await addSegments('hanbat', ['unknown', 'confirmed_none', 'present'])
    expect(ids(await searchCandidates(query({ styles: ['자연·산책'], avoidStairs: true }), db))).toEqual(['art', 'leeungno', 'hanbat'])
  })

  it('unknown·confirmed_none뿐인 장소와 구간 기록이 없는 장소는 뒤로 보내지도 빼지도 않는다', async () => {
    await addSegments('hanbat', ['unknown', 'confirmed_none'])
    const rows = await searchCandidates(query({ styles: ['자연·산책'], avoidStairs: true }), db)
    expect(ids(rows)).toEqual(['hanbat', 'art', 'leeungno'])
  })

  it('예산·이동수단은 순위에 쓰지 않는다 (장소 데이터에 근거 칸이 없다)', async () => {
    const base = ids(await searchCandidates(query({ styles: ['문화·역사'] }), db))
    const cheapWalk = ids(await searchCandidates(query({ styles: ['문화·역사'], budget: 'under_30k', transport: 'walk' }), db))
    const pricyTaxi = ids(await searchCandidates(query({ styles: ['문화·역사'], budget: 'over_100k', transport: 'taxi' }), db))
    expect(cheapWalk).toEqual(base)
    expect(pricyTaxi).toEqual(base)
  })

  it('잘못된 입력은 DB를 읽기 전에 거부한다', async () => {
    for (const bad of [{ limit: -1 }, { limit: 1.5 }, { limit: 101 }, { transport: 'rocket' }, { budget: 'cheap' }]) {
      await expect(searchCandidates({ ...query(), ...bad } as unknown as PlaceCandidateQuery, db)).rejects.toThrow()
    }
  })
})

describe('matchPlaceByName', () => {
  it('이름이 같으면 요약 계약대로 돌려준다 (공백 무시)', async () => {
    const found = await matchPlaceByName(' 한밭 수목원 ', db)
    expect(found?.id).toBe('hanbat')
    expect(PlaceSummarySchema.safeParse(found).success).toBe(true)
    expect((await matchPlaceByName('대전시립미술관', db))?.id).toBe('art')
  })

  it('입력 안에 장소 이름이 통째로 들어 있으면 맞춘다', async () => {
    expect((await matchPlaceByName('10시 한밭수목원 산책', db))?.id).toBe('hanbat')
  })

  it('근처·앞·주변·옆이 붙은 입력은 맞추지 않는다', async () => {
    for (const input of ['한밭수목원 근처 식당', '한밭수목원 앞', '대전시립미술관 주변', '이응노미술관 옆 카페']) {
      expect(await matchPlaceByName(input, db)).toBeNull()
    }
  })

  it('이름의 일부, DB에 없는 이름, 빈 입력은 null', async () => {
    for (const input of ['미술관', '수목원', '성심당 본점', '   ', '...']) {
      expect(await matchPlaceByName(input, db)).toBeNull()
    }
  })

  it('이름이 같은 장소가 둘이면 null', async () => {
    await insertPilotPlaces(db, [{ ...pilots[0], id: 'hanbat2' }])
    expect(await matchPlaceByName('한밭수목원', db)).toBeNull()
    expect((await matchPlaceByName('대전시립미술관', db))?.id).toBe('art')
  })
})
