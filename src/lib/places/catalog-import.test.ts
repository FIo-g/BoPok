import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema'
import { placeCatalog, places } from '@/lib/db/schema/places'
import { placeResearch } from '@/lib/db/schema/place-research'
import { importPreparedCatalog, prepareFoodCatalog, prepareTourCatalog } from './catalog-import'
import { getPlaceDetails, listPlaces } from './index'
import { getPlaceCostChoices } from './cost-choices'

const client = new PGlite('memory://')
const db = drizzle(client, { schema })
const food = (id = 1) => ({ raw: { REST_ID: id, REST_NM: `가상 식당 ${id}`, TOB_INFO: '한식',
  ADDR: '대전광역시 가상 주소', LOT: '127.38', LAT: '36.35', MENU_KORN_NM: ['가상 국수'], MENU_AMT: ['8,000원'] },
retrievedAt: '2026-11-03T00:00:00.000Z' })

beforeAll(async () => { await migrate(db, { migrationsFolder: './drizzle' }) }, 30000)
beforeEach(async () => { await db.execute(sql`truncate places cascade`) })
afterAll(async () => { await client.close() })

describe('공용 장소 계약에 수집 자료 적재', () => {
  it('검토된 동일 TourAPI 콘텐츠는 연구용 장소 요약을 보존한 채 원본만 붙인다', async () => {
    const entry = prepareTourCatalog({ raw: { list: { contentid: '22', contenttypeid: '14', title: '가상 박물관',
      lDongRegnCd: '30', mapx: '127.38', mapy: '36.35' }, common: [], intro: [], details: [], images: [], menuImages: [], pet: [] },
    sources: [{ endpoint: 'detailCommon2', retrievedAt: '2026-11-03T00:00:00.000Z' }] })
    await db.insert(places).values({ id: entry.summary.id, name: '사람이 검토한 가상 박물관', category: '기존 분류', styles: [],
      lng: 127.39, lat: 36.36, seated: false, indoor: true, source: 'https://example.test/manual', checkedAt: '2026-10-31', confidence: 'A' })
    const before = await db.select().from(places)
    await expect(importPreparedCatalog(db, [entry])).rejects.toThrow('덮어쓰지')
    await db.insert(placeResearch).values({ namespace: 'test-review', entity: 'candidate', externalId: 'DJ-001', placeId: entry.summary.id,
      hash: 'a'.repeat(64), data: { original: { tourApiMatch: { matchKind: 'alias_address', primary: { contentid: '22' } } }, mapping: { dbId: entry.summary.id } } })
    expect(await importPreparedCatalog(db, [entry])).toMatchObject({ inserted: 1 })
    expect(await db.select().from(places)).toEqual(before)
    expect(await importPreparedCatalog(db, [entry])).toMatchObject({ inserted: 0, unchanged: 1 })
  })
  it('전체 출처·원문·가격 단위를 보존하고 목록에는 큰 메뉴 원문을 보내지 않는다', async () => {
    const entry = prepareFoodCatalog(food())
    expect(await importPreparedCatalog(db, [entry])).toEqual({ inserted: 1, unchanged: 0, total: 1 })
    const summaries = await listPlaces({}, db)
    expect(summaries[0]).toMatchObject({ id: 'daejeon-food-1', kind: 'restaurant', seated: true })
    expect(summaries[0]).not.toHaveProperty('menus')
    const detail = (await getPlaceDetails(['daejeon-food-1'], db))[0]
    expect(detail.menus?.[0]).toMatchObject({ name: '가상 국수', priceKrw: 8000, foodTags: [], source: entry.summary.source })
    expect(detail.segments).toEqual([])
    const stored = (await db.select().from(placeCatalog))[0]
    expect(stored.data).toMatchObject({ menus: [{ unit: 'unspecified' }], dietaryTagsVerified: false })
    expect(stored.data.raw).toMatchObject(food().raw)
  })

  it('같은 자료는 재실행해도 중복되지 않고 원문이 바뀌면 쓰기 전에 전체를 거절한다', async () => {
    const entry = prepareFoodCatalog(food())
    await importPreparedCatalog(db, [entry])
    expect(await importPreparedCatalog(db, [entry])).toEqual({ inserted: 0, unchanged: 1, total: 1 })
    const changed = food()
    changed.raw.REST_NM = '다른 이름'
    await expect(importPreparedCatalog(db, [prepareFoodCatalog(food(2)), prepareFoodCatalog(changed)])).rejects.toThrow('덮어쓰지')
    expect(await db.select().from(places)).toHaveLength(1)
    expect(await db.select().from(placeCatalog)).toHaveLength(1)
  })

  it('명확하지 않은 가격은 무료로 저장하지 않으며 음식 주의 태그를 추측하지 않는다', () => {
    const value = food()
    value.raw.MENU_AMT = ['문의']
    const entry = prepareFoodCatalog(value)
    expect(entry.menus[0]).not.toHaveProperty('priceKrw')
    expect(entry.menus[0].foodTags).toEqual([])
    expect(() => prepareFoodCatalog({ ...value, raw: { ...value.raw, LAT: '' } })).toThrow()
  })

  it('메뉴 가격은 1인분으로 확정하지 않고, 모르는 장소 가격은 무료가 아니다', async () => {
    const entry = prepareFoodCatalog(food())
    await importPreparedCatalog(db, [entry])
    const result = await getPlaceCostChoices({ ids: [entry.summary.id, 'not-found'] }, db)
    expect(result[0].options[0]).toMatchObject({ amountKrw: 8000, unit: 'unspecified', kind: 'meal' })
    expect(result[1].options).toEqual([])
  })

  it('TourAPI 연결 시 기존 수동 좌표·홈페이지를 유지하고 가격 출처는 별도로 보존한다', async () => {
    const curated = JSON.parse(readFileSync('data/places/hanbat.json', 'utf8'))
    const entry = prepareTourCatalog({ raw: {
      list: { contentid: '741658', contenttypeid: '12', title: '한밭수목원', lDongRegnCd: '30', mapx: '127.38625', mapy: '36.36858' },
      common: [], intro: [{ usefee: '무료' }], details: [], images: [], menuImages: [], pet: [],
    }, sources: [{ endpoint: 'detailIntro2', retrievedAt: '2026-11-03T00:00:00.000Z' }] }, curated)
    await importPreparedCatalog(db, [entry])
    expect((await getPlaceDetails(['hanbat'], db))[0]).toMatchObject({ coord: curated.coord, homepage: curated.homepage })
    expect(await importPreparedCatalog(db, [entry])).toMatchObject({ unchanged: 1 })
    const options = (await getPlaceCostChoices({ ids: ['hanbat'] }, db))[0].options
    expect(options[0]).toMatchObject({ amountKrw: 0, unit: 'per_person', checkedAt: '2026-11-03', source: entry.data.source })
  })

  it('숙박의 시기별 객실 요금과 최대 인원은 원본 메타데이터에 보존한다', async () => {
    const entry = prepareTourCatalog({ raw: {
      list: { contentid: '22', contenttypeid: '32', title: '가상 숙소', lDongRegnCd: '30', mapx: '127.38', mapy: '36.35' },
      common: [], intro: [], details: [{ roomtitle: '가상 객실', roommaxcount: '4', roomoffseasonminfee1: '80000' }],
      images: [], menuImages: [], pet: [],
    }, sources: [{ endpoint: 'detailInfo2', retrievedAt: '2026-11-03T00:00:00.000Z' }] })
    await importPreparedCatalog(db, [entry])
    expect((await getPlaceDetails([entry.summary.id], db))[0].kind).toBe('lodging')
    expect((await db.select().from(placeCatalog))[0].data).toMatchObject({ lodging: {
      rooms: [{ maxGuests: 4, unit: 'room_per_night', publishedRates: { offSeasonWeekday: { amountKrw: 80000 } } }],
    } })
  })

  it('장소 행만 저장된 중단도 원래 내용이 같은 경우에만 재개한다', async () => {
    const entry = prepareFoodCatalog(food())
    const place = entry.summary
    await db.insert(places).values({ ...place, lng: place.coord[0], lat: place.coord[1] })
    expect(await importPreparedCatalog(db, [entry])).toMatchObject({ inserted: 1 })
  })

  it('새 마이그레이션 미적용 상태에서도 기존 장소 목록과 상세를 읽는다', async () => {
    const legacy = new PGlite('memory://')
    try {
      for (const name of ['0000_rainy_dust.sql', '0001_place-schema.sql', '0002_trips-versions.sql']) {
        await legacy.exec(readFileSync(`drizzle/${name}`, 'utf8').replaceAll('--> statement-breakpoint', ''))
      }
      const oldDb = drizzle(legacy, { schema })
      await legacy.exec("insert into places(id,name,category,styles,lng,lat,seated,indoor,source,checked_at,confidence) values('legacy','가상 관광지','관광지','{}',127.38,36.35,false,false,'https://example.test','2026-11-03','B')")
      expect((await listPlaces({}, oldDb))[0].kind).toBeUndefined()
      expect((await getPlaceDetails(['legacy'], oldDb))[0].name).toBe('가상 관광지')
    } finally { await legacy.close() }
  }, 30000)
})
