import { describe, expect, it } from 'vitest'
import {
  MenuItemSchema, PlaceCourseSchema, PlaceDetailSchema, PlaceKindSchema, PlaceModelSchema, PlaceNodeSchema,
  PlaceZoneSchema, placeKindOf,
} from './index'

// 새 칸이 하나도 없는 기존 저장 모양 (nodes·segments만). 이것이 계속 통과해야 기존 데이터가 안 깨진다.
const existingDetail = {
  id: 'hanbat',
  name: '한밭수목원',
  category: '공원',
  styles: ['nature'],
  coord: [127.3846, 36.3688],
  seated: false,
  indoor: false,
  source: '한밭수목원 공식 안내도',
  checkedAt: '2026-11',
  confidence: 'A',
  nodes: [
    { id: 'rest-indoor', placeId: 'hanbat', kind: 'rest', name: '실내 쉼터', restType: 'indoor', coord: [127.3846, 36.3688] },
    { id: 'deck', placeId: 'hanbat', kind: 'sight', name: '전망 데크', restType: null, coord: [127.3836, 36.368] },
  ],
  segments: [
    {
      id: 'hanbat-s3',
      placeId: 'hanbat',
      fromNodeId: 'rest-indoor',
      toNodeId: 'deck',
      order: 3,
      distanceM: 140,
      path: [[127.3846, 36.3688], [127.3836, 36.368]],
      stairsStatus: 'present',
      stairsCount: 24,
      slope: false,
      optional: false,
      source: '한밭수목원 공식 안내도',
      checkedAt: '2026-11',
      confidence: 'A',
    },
  ],
}

describe('장소 종류', () => {
  it('kind 없는 기존 장소는 관광지로 본다', () => {
    expect(placeKindOf({})).toBe('attraction')
    expect(placeKindOf({ kind: 'cafe' })).toBe('cafe')
  })
  it('모르는 종류는 거부', () => {
    expect(PlaceKindSchema.safeParse('bar').success).toBe(false)
  })
})

describe('장소 안 안내도', () => {
  it('흡연장 지점과 층·안내도 번호', () => {
    const node = { id: 'n1', placeId: 'aq', kind: 'smoking', name: '흡연 구역', restType: null, coord: [127.38, 36.35], floor: -1, guideNo: 3 }
    expect(PlaceNodeSchema.safeParse(node).success).toBe(true)
    expect(PlaceNodeSchema.safeParse({ ...node, guideNo: 0 }).success).toBe(false)
  })
  it('구역은 꼭짓점 3개 이상', () => {
    const zone = { id: 'z1', name: '1층 전시실', floor: 1, polygon: [[127.38, 36.35], [127.381, 36.35], [127.381, 36.351]], confidence: 'B' }
    expect(PlaceZoneSchema.safeParse(zone).success).toBe(true)
    expect(PlaceZoneSchema.safeParse({ ...zone, polygon: zone.polygon.slice(0, 2) }).success).toBe(false)
  })
  it('구역에도 신뢰 등급이 필요하고, 출처·확인 날짜는 함께 담긴다', () => {
    const zone = { id: 'z1', name: '1층 전시실', floor: 1, polygon: [[127.38, 36.35], [127.381, 36.35], [127.381, 36.351]] }
    expect(PlaceZoneSchema.safeParse(zone).success).toBe(false)
    const parsed = PlaceZoneSchema.parse({ ...zone, confidence: 'A', source: '현장 안내도', checkedAt: '2026-11' })
    expect(parsed).toMatchObject({ confidence: 'A', source: '현장 안내도', checkedAt: '2026-11' })
  })
  it('모형 크기는 0보다 커야 한다', () => {
    const model = { url: '/models/aq.glb', anchor: [127.38, 36.35], rotationDeg: 90, scale: 1, altitudeM: 0 }
    expect(PlaceModelSchema.safeParse(model).success).toBe(true)
    expect(PlaceModelSchema.safeParse({ ...model, scale: 0 }).success).toBe(false)
  })
  it('코스·메뉴에는 신뢰 등급이 필요', () => {
    expect(PlaceCourseSchema.safeParse({ id: 'c1', name: '동원', recommended: true }).success).toBe(false)
    expect(MenuItemSchema.safeParse({ name: '팥빙수', priceKrw: 9000, foodTags: ['sugary'], confidence: 'B' }).success).toBe(true)
    expect(MenuItemSchema.safeParse({ name: '팥빙수', foodTags: ['spicy'], confidence: 'B' }).success).toBe(false)
  })
  it('새 칸이 없는 기존 장소 상세도 그대로 통과', () => {
    expect(PlaceDetailSchema.safeParse(existingDetail).success).toBe(true)
  })
})
