import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as list } from '@/app/api/places/route'
import { GET as detail } from '@/app/api/places/[id]/route'
import { POST as details } from '@/app/api/places/details/route'
import { ApiErrorSchema, PlaceDetailSchema, PlaceDetailsResponseSchema, PlaceSummaryListSchema } from '@/lib/contracts'
import type { Db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { places, placeNodes, placeSegments } from '@/lib/db/schema/places'
import { getPlaceDetails } from './index'
import { insertPilotPlaces, PilotPlaceSchema } from './seed'

// 실제 연결 함수만 대체한다. HTTP 처리·SQL·마이그레이션·응답 검사는 그대로 실행한다.
const state = vi.hoisted(() => ({ db: null as Db | null }))
vi.mock('@/lib/db/client', () => ({
  getDb: () => {
    if (!state.db) throw new Error('테스트용 DB 연결 실패: 출력하면 안 되는 내부 정보')
    return state.db
  },
}))
const client = new PGlite('memory://')
const db = drizzle(client, { schema })
const pilots = ['hanbat', 'art', 'leeungno'].map(id => PilotPlaceSchema.parse(
  JSON.parse(readFileSync(new URL(`../../../data/places/${id}.json`, import.meta.url), 'utf8')),
))
const request = (path: string) => new Request(`http://localhost${path}`)
const get = (id: string) => detail(request(`/api/places/${id}`), { params: Promise.resolve({ id }) })
const post = (body: unknown) => details(new Request('http://localhost/api/places/details', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))

beforeAll(async () => { await migrate(db, { migrationsFolder: './drizzle' }) }, 30000)
beforeEach(async () => {
  state.db = db
  // 이 테스트가 새로 만든 memory:// 안에서만 초기화한다. 디스크 DB는 열지 않는다.
  await db.execute(sql`truncate table places cascade`)
  await insertPilotPlaces(db, pilots)
})
afterAll(async () => { await client.close() })

describe('장소 API와 실제 마이그레이션 DB', () => {
  it('목록은 공용 요약 계약과 출처를 만족하고 내부 필드와 미조사 시간을 보내지 않는다', async () => {
    const response = await list(request('/api/places'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body: unknown = await response.json()
    const rows = PlaceSummaryListSchema.parse(body)
    expect(rows.map(row => row.id).sort()).toEqual(['art', 'hanbat', 'leeungno'])
    for (const row of rows) {
      expect(row.source).toMatch(/^https:\/\//)
      expect(row.checkedAt).toBe('2026-10-31')
      expect(row.confidence).toBe('B')
      expect(row).not.toHaveProperty('visitMin')
    }
    expect(body).toEqual(rows)
    expect(JSON.stringify(body)).not.toMatch(/"(lng|lat|nodes|segments)":/)
  })

  it('이름 부분 검색과 스타일 OR 필터를 AND로 결합한다', async () => {
    const response = await list(request(`/api/places?${new URLSearchParams({ q: '미술관', styles: '자연·산책,문화·역사' })}`))
    expect(PlaceSummaryListSchema.parse(await response.json()).map(row => row.id)).toEqual(['art', 'leeungno'])
    const none = await list(request(`/api/places?${new URLSearchParams({ q: '미술관', styles: '자연·산책' })}`))
    expect(await none.json()).toEqual([])
    expect(await (await list(request('/api/places?styles=&q='))).json()).toHaveLength(3)
  })

  it('검색어의 SQL 와일드카드와 역슬래시를 문자 그대로 찾는다', async () => {
    await db.update(places).set({ name: '가상 %_\\ 장소' }).where(eq(places.id, 'hanbat'))
    for (const q of ['%_', '\\', "' OR 1=1 --"]) {
      const response = await list(request(`/api/places?${new URLSearchParams({ q })}`))
      expect(response.status).toBe(200)
      expect(PlaceSummaryListSchema.parse(await response.json()).map(row => row.id)).toEqual(q.includes('OR') ? [] : ['hanbat'])
    }
  })

  it.each(['/api/places?q=a&q=b', '/api/places?styles=a&styles=b', `/api/places?q=${'a'.repeat(101)}`, `/api/places?styles=${Array(11).fill('a').join(',')}`])(
    '잘못된 목록 입력은 400: %s', async path => {
      const response = await list(request(path))
      expect(response.status).toBe(400)
      expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('invalid_request')
    },
  )

  it('상세의 좌표와 빈 내부 경로는 계약을 만족하며 미조사 숫자를 만들지 않는다', async () => {
    const response = await get('hanbat')
    expect(response.status).toBe(200)
    const row = PlaceDetailSchema.parse(await response.json())
    expect(row.coord).toEqual([127.387876, 36.365932])
    expect(row.nodes).toEqual([])
    expect(row.segments).toEqual([])
    expect(row).not.toHaveProperty('visitMin')
    expect(JSON.stringify(row)).not.toContain('confirmed_none')
    expect(JSON.stringify(row)).not.toContain('stairsCount')
  })

  it('없는 장소는 404, 잘못된 ID는 400이다', async () => {
    expect((await get('missing')).status).toBe(404)
    expect((await get('../places')).status).toBe(400)
    expect((await get('')).status).toBe(400)
    const response = await get('missing')
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('not_found')
  })

  it('여러 상세는 요청 순서를 보존하고 중복과 없는 ID를 제외한다', async () => {
    const response = await post({ ids: ['leeungno', 'missing', 'hanbat', 'leeungno', 'art'] })
    expect(response.status).toBe(200)
    expect(PlaceDetailsResponseSchema.parse(await response.json()).map(row => row.id)).toEqual(['leeungno', 'hanbat', 'art'])
    expect(await (await post({ ids: [] })).json()).toEqual([])
    expect(await (await post({ ids: ['missing'] })).json()).toEqual([])
  })

  it.each([null, {}, { ids: 'hanbat' }, { ids: [1] }, { ids: [''] }, { ids: ['a/b'] }, { ids: Array(101).fill('hanbat') }, { ids: [], unexpected: true }])(
    '잘못된 여러 상세 입력은 400: %j', async body => {
      const response = await post(body)
      expect(response.status).toBe(400)
      expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('invalid_request')
    },
  )

  it('JSON이 아닌 형식은 415, 잘못된 JSON과 과도한 본문은 400이다', async () => {
    const wrongType = await details(new Request('http://localhost/api/places/details', { method: 'POST', body: '{}' }))
    expect(wrongType.status).toBe(415)
    for (const body of ['{', '', JSON.stringify({ ids: ['a'.repeat(16384)] })]) {
      const response = await details(new Request('http://localhost/api/places/details', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body,
      }))
      expect(response.status).toBe(400)
    }
  })

  it('DB 오류는 세 API 모두 내부 정보를 숨기는 500 응답이다', async () => {
    state.db = null
    for (const response of [await list(request('/api/places')), await get('hanbat'), await post({ ids: ['hanbat'] })]) {
      expect(response.status).toBe(500)
      const body: unknown = await response.json()
      expect(ApiErrorSchema.parse(body).error.code).toBe('internal_error')
      expect(JSON.stringify(body)).not.toContain('출력하면 안 되는 내부 정보')
    }
  })

  it('DB에 계약 위반 값이 있어도 잘못된 성공 응답을 내보내지 않는다', async () => {
    await db.execute(sql`update places set styles = ARRAY[NULL]::text[] where id = 'hanbat'`)
    expect((await list(request('/api/places'))).status).toBe(500)
    expect((await get('hanbat')).status).toBe(500)
    expect((await post({ ids: ['hanbat'] })).status).toBe(500)
  })

  it('저장된 지점·구간의 순서와 nullable 값을 계약대로 변환한다', async () => {
    await db.insert(placeNodes).values([
      { id: 'entrance', placeId: 'hanbat', kind: 'entrance', name: '가상 입구', lng: 127.38, lat: 36.36 },
      { id: 'sight', placeId: 'hanbat', kind: 'sight', name: '가상 볼거리', lng: 127.381, lat: 36.361 },
    ])
    const segment = {
      placeId: 'hanbat', fromNodeId: 'entrance', toNodeId: 'sight', distanceM: 10,
      path: [[127.38, 36.36], [127.381, 36.361]] as [number, number][],
      stairsStatus: 'unknown' as const, slope: false, optional: false,
      source: '테스트용 가상 구간', checkedAt: '2026-10-31', confidence: 'C' as const,
    }
    await db.insert(placeSegments).values([{ ...segment, id: 'later', order: 1 }, { ...segment, id: 'first', order: 0 }])
    const [row] = await getPlaceDetails(['hanbat'])
    expect(PlaceDetailSchema.safeParse(row).success).toBe(true)
    expect(row.nodes[0].coord).toEqual([127.38, 36.36])
    expect(row.nodes[0].restType).toBeNull()
    expect(row.segments.map(item => item.id)).toEqual(['first', 'later'])
    expect(row.segments[0].stairsCount).toBeUndefined()
    expect(row.segments[0].detourOf).toBeUndefined()
  })
})

describe('시범 장소 적재 안전성', () => {
  it('같은 데이터를 다시 넣어도 기존 행과 다른 장소를 보존한다', async () => {
    expect(await insertPilotPlaces(db, [pilots[0]])).toEqual({ ids: ['hanbat'], inserted: 0, unchanged: 1 })
    expect(await db.select().from(places)).toHaveLength(3)
    const changed = { ...pilots[0], name: '다른 내용' }
    await expect(insertPilotPlaces(db, [changed])).rejects.toThrow('덮어쓰지 않습니다')
    expect((await getPlaceDetails(['hanbat']))[0].name).toBe('한밭수목원')
  })

  it('출처·날짜·등급 누락과 미조사 숫자·내부 경로를 적재하지 않는다', async () => {
    for (const field of ['source', 'checkedAt', 'confidence'] as const) {
      const invalid = { ...pilots[0], [field]: undefined }
      await expect(insertPilotPlaces(db, [invalid])).rejects.toThrow()
    }
    for (const invalid of [
      { ...pilots[0], source: '' }, { ...pilots[0], checkedAt: 'not-a-date' },
      { ...pilots[0], visitMin: 0 }, { ...pilots[0], nodes: [{}] }, { ...pilots[0], segments: [{}] },
    ]) await expect(insertPilotPlaces(db, [invalid])).rejects.toThrow()
    await expect(insertPilotPlaces(db, [pilots[0], pilots[0]])).rejects.toThrow('중복')
    expect(await db.select().from(places)).toHaveLength(3)
  })
})
