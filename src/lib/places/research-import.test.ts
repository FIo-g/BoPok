import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestDb, type TestDb } from '@/lib/db/test-db'
import { places } from '@/lib/db/schema/places'
import { placeResearch } from '@/lib/db/schema/place-research'
import { applyResearch, planResearch } from './research-import'
import { GET as list } from '@/app/api/places/route'
import { GET as detail } from '@/app/api/places/[id]/route'
import { ResearchNotice } from '@/components/trip/ResearchInfo'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
function fixture() {
  const candidates = Array.from({ length: 108 }, (_, i) => ({ id: `DJ-${String(i + 1).padStart(3, '0')}`, name: `가상 장소 ${i}`,
    officialUrls: ['https://example.test/source'], location: i === 0 ? { lon: 127.38, lat: 36.35, isEntrance: false } : null,
    tourApiMatch: { matchKind: i === 0 ? 'exact_name' : 'no_match', primary: i === 0 ? { contentid: '123', contenttypeid: '14' } : null },
    observationIds: i === 0 ? ['F-0'] : [], continuousWheelchairAccess: 'unverified_for_entire_place',
  }))
  const observations = Array.from({ length: 1707 }, (_, i) => ({ observationId: `F-${i}`, placeId: 'DJ-001',
    excludeFromPlaceSummary: i < 39, valueRaw: i < 39 ? '보류값_공개금지' : '일부 입구만 확인', numericValue: null, unit: null, scope: '특정 건물', direction: null }))
  return { schemaVersion: 'bopok.research.v2', researchDate: '2026-11-03', places: candidates, observations,
    sourceChecks: candidates.flatMap(p => Array.from({ length: 6 }, (_, i) => ({ placeId: p.id, source: i + 1, status: '미확인' }))),
    apiFields: Array.from({ length: 2492 }, () => ({ placeId: 'DJ-001', numericValue: 0, unit: '기종점 미확인' })),
    apiImages: Array.from({ length: 949 }, () => ({ placeId: 'DJ-001', originimgurl: 'https://example.test/private.jpg', cpyrhtDivCd: null })),
    quarantined: observations.slice(0, 39), conflicts: [{ values: '충돌값 보존' }],
  }
}
const geo = () => ({ type: 'FeatureCollection', features: Array.from({ length: 4328 }, (_, i) => ({
  type: 'Feature', id: `way/${i}`, geometry: { type: 'Point', coordinates: [127.38, 36.35] },
  properties: { placeIds: ['DJ-001'], relationToSites: [{ relationToSite: 'bbox_only' }], length_m: 0 },
})) })
let db: TestDb
beforeAll(async () => { db = await setupTestDb() }, 60000)
afterAll(async () => { await db.close() })
describe('오프라인 조사자료의 범위 보존', () => {
  it('108후보 전체 처리 및 부분시설·좌표 미확보 보류', () => {
    const input = fixture(); input.places[0].tourApiMatch.matchKind = 'subsite_only'
    const plan = planResearch(input, geo(), [])
    expect(plan.mapping).toHaveLength(108)
    expect(plan.report.pending).toBe(108)
    expect(plan.rows.find(r => r.entity === 'observations')?.data).toMatchObject({ numericValue: null, unit: null, scope: '특정 건물' })
    expect(plan.rows.find(r => r.entity === 'osm')?.data).toHaveProperty('properties.relationToSites')
  })
  it('좌표 범위·참조 오류는 원본 ID와 필드로 거절한다', () => {
    const input = fixture(); input.places[0].location!.lat = 127
    expect(() => planResearch(input, geo(), [])).toThrow('DJ-001.location')
    input.places[0].location!.lat = 36.35; input.places[0].observationIds = ['missing']
    expect(() => planResearch(input, geo(), [])).toThrow('missing')
  })
  it('기존 장소를 덮어쓰지 않고 두 번 적재해도 장소·근거·사진·OSM이 증가하지 않는다', async () => {
    const plan = planResearch(fixture(), geo(), [])
    await db.db.insert(places).values({ id: 'tourapi-14-123', name: '가상 장소 0', category: '사람이 확인한 값 보존', styles: [],
      lng: 127.39, lat: 36.36, seated: true, indoor: true, source: 'https://example.test/original', checkedAt: '2026-10-31', confidence: 'A' })
    const before = await db.db.select().from(places)
    const first = await applyResearch(db.db, plan)
    const second = await applyResearch(db.db, plan)
    expect(first.added).toBe(0)
    expect(second).toMatchObject({ added: 0, recordsAdded: 0 })
    expect(await db.db.select().from(places)).toEqual(before)
    expect(await db.db.select().from(placeResearch)).toHaveLength(plan.rows.length)
  }, 60000)
  it('실제 목록·상세 핸들러와 화면 안내에는 보류·이미지·주변 객체가 확정값으로 나오지 않는다', async () => {
    const listing = await list(new Request('http://localhost/api/places'))
    expect(listing.status).toBe(200)
    const response = await detail(new Request('http://localhost/api/places/tourapi-14-123'), { params: Promise.resolve({ id: 'tourapi-14-123' }) })
    const value = await response.json()
    expect(response.status).toBe(200)
    expect(value.research.continuousWheelchairAccess).toBe('unverified')
    expect(value.segments).toEqual([])
    const html = renderToStaticMarkup(createElement(ResearchNotice, { research: value.research }))
    expect(html).toContain('미확인')
    for (const text of ['보류값_공개금지', 'private.jpg', 'bbox_only']) expect(JSON.stringify(value) + html).not.toContain(text)
  })
})
