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
import { fillPlaceInside, syncNodeLabels } from './inside'
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

  it('장소 안 전용 파일 형식({ placeId, nodes, segments })도 같은 방식으로 넣는다', async () => {
    const file = { placeId: 'hanbat', nodes: hanbat.nodes, segments: hanbat.segments, courses: hanbat.courses }
    expect(await fillPlaceInside(db, file)).toEqual({ placeId: 'hanbat', nodes: hanbat.nodes.length, segments: hanbat.segments.length })
    expect(await countInside('hanbat')).toEqual({ nodes: hanbat.nodes.length, segments: hanbat.segments.length })
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

describe('지점의 안내도 번호·층', () => {
  // 번호·층 칸이 없는 옛 데이터 모양을 만든다.
  const dropLabels = (node: Record<string, unknown>) => Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== 'guideNo' && key !== 'floor'),
  )
  const withoutLabels = (entry: typeof hanbat) => ({
    ...entry,
    nodes: entry.nodes.map(node => dropLabels(node)),
  })
  const labelsOf = async (placeId: string) => (await db.select({
    id: placeNodes.id, floor: placeNodes.floor, guideNo: placeNodes.guideNo,
  }).from(placeNodes).where(eq(placeNodes.placeId, placeId))).sort((a, b) => a.id.localeCompare(b.id))

  it('넣을 때 번호를 저장하고 상세에서 읽는다. 값이 없는 지점은 칸을 빼서 돌려준다', async () => {
    const floorNode = { ...hanbat.nodes[0], id: 'hb-floor-test', floor: -1 }
    await fillPlaceInside(db, { ...hanbat, nodes: [...hanbat.nodes, floorNode] })
    const [detail] = await getPlaceDetails(['hanbat'], db)
    expect(detail.nodes.find(node => node.id === 'hb-floor-test')).toMatchObject({ floor: -1 })
    expect(detail.nodes.find(node => node.id === 'hb-floor-test')).not.toHaveProperty('guideNo')
    const guided = hanbat.nodes.filter(node => node.guideNo !== undefined)
    expect(guided.length).toBeGreaterThan(0)
    for (const node of guided) {
      expect(detail.nodes.find(item => item.id === node.id)).toMatchObject({ guideNo: node.guideNo })
    }
    const unguided = detail.nodes.find(node => node.guideNo === undefined && node.floor === undefined)
    expect(unguided).toBeDefined()
    expect(unguided).not.toHaveProperty('guideNo')
    expect(unguided).not.toHaveProperty('floor')
  })

  it('DB의 guide_no가 0 이하이면 칸 검사가 막는다', async () => {
    await fillPlaceInside(db, withoutLabels(hanbat))
    await expect(db.update(placeNodes).set({ guideNo: 0 }).where(eq(placeNodes.placeId, 'hanbat'))).rejects.toThrow()
  })

  it('이미 있는 장소에 번호가 null인 칸만 파일 값으로 채우고 다른 칸은 그대로 둔다', async () => {
    await fillPlaceInside(db, withoutLabels(hanbat))
    const before = await getPlaceDetails(['hanbat'], db)
    const result = await syncNodeLabels(db, hanbat)
    const guided = hanbat.nodes.filter(node => node.guideNo !== undefined)
    expect(result).toEqual({
      placeId: 'hanbat', filled: guided.length, alreadySame: 0, conflicts: [], notInDb: [], dryRun: false,
    })
    const labels = await labelsOf('hanbat')
    for (const node of guided) expect(labels.find(row => row.id === node.id)?.guideNo).toBe(node.guideNo)
    const after = await getPlaceDetails(['hanbat'], db)
    // 번호 말고는 바뀌지 않는다
    expect(after[0].nodes.map(node => dropLabels(node))).toEqual(before[0].nodes)
    expect(after[0].segments).toEqual(before[0].segments)
  })

  it('다시 실행하면 같은 값은 건드리지 않고 헤아리기만 한다', async () => {
    await fillPlaceInside(db, hanbat)
    const first = await syncNodeLabels(db, hanbat)
    expect(first.filled).toBe(0)
    expect(first.alreadySame).toBe(hanbat.nodes.reduce((n, node) => n + (node.guideNo !== undefined ? 1 : 0), 0))
    expect(first.conflicts).toEqual([])
  })

  it('DB 값과 파일 값이 다르면 바꾸지 않고 충돌로 알린다', async () => {
    await fillPlaceInside(db, hanbat)
    await db.update(placeNodes).set({ guideNo: 99 }).where(eq(placeNodes.id, 'hb-hydrangea'))
    const result = await syncNodeLabels(db, hanbat)
    expect(result.conflicts).toEqual([{ nodeId: 'hb-hydrangea', field: 'guideNo', db: 99, file: 17 }])
    expect((await labelsOf('hanbat')).find(row => row.id === 'hb-hydrangea')?.guideNo).toBe(99)
  })

  it('dry-run은 아무것도 쓰지 않고 채울 개수만 알린다', async () => {
    await fillPlaceInside(db, withoutLabels(hanbat))
    const before = await labelsOf('hanbat')
    const result = await syncNodeLabels(db, hanbat, { dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(result.filled).toBeGreaterThan(0)
    expect(await labelsOf('hanbat')).toEqual(before)
  })

  it('파일에 있지만 DB에 없는 지점은 넣지 않고 목록으로 알린다', async () => {
    await fillPlaceInside(db, withoutLabels(hanbat))
    const extra = { ...hanbat, nodes: [...hanbat.nodes, { ...hanbat.nodes[0], id: 'hb-extra', guideNo: 50 }] }
    const result = await syncNodeLabels(db, extra)
    expect(result.notInDb).toEqual(['hb-extra'])
    expect((await labelsOf('hanbat')).some(row => row.id === 'hb-extra')).toBe(false)
  })

  it('장소가 DB에 없으면 실패한다', async () => {
    await expect(syncNodeLabels(db, { ...hanbat, id: 'missing' })).rejects.toThrow('DB에 없어')
  })

  // 마이그레이션 0007 적용 전의 공용 DB를 흉내 낸다. 이 테스트는 파일의 마지막에 둔다(칸을 다시 붙인다).
  it('마이그레이션 전에는 상세 조회가 번호 없이 되고, 번호 채우기는 먼저 적용하라고 막는다', async () => {
    await fillPlaceInside(db, hanbat)
    await db.execute(sql`alter table place_nodes drop column guide_no, drop column floor`)
    try {
      const [detail] = await getPlaceDetails(['hanbat'], db)
      expect(detail.nodes).toHaveLength(hanbat.nodes.length)
      expect(detail.nodes.some(node => 'guideNo' in node || 'floor' in node)).toBe(false)
      await expect(syncNodeLabels(db, hanbat)).rejects.toThrow('0007')
    } finally {
      await db.execute(sql`alter table place_nodes add column guide_no integer, add column floor integer`)
    }
  })
})
