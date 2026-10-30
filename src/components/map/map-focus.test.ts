import { describe, expect, it } from 'vitest'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { Coord } from '@/lib/contracts'
import { crossingBearing, focusZone, nearBuildingIds, veilPolygon } from './map-focus'
import { MAP_MAX_BOUNDS } from './map-config'

// 한밭수목원 전망 데크로 가는 구간(목업 좌표)
const hb3Path: Coord[] = [[127.3846, 36.3688], [127.3841, 36.3684], [127.3836, 36.368]]

// [경도, 위도] 중심에서 한 변이 약 20m 인 정사각형 건물
const building = (fid: number, [lon, lat]: [number, number]): Feature<Polygon> => {
  const d = 0.0001
  return {
    type: 'Feature',
    properties: { fid },
    geometry: { type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] },
  }
}
const [mx, my] = hb3Path[1] // 구간 가운데
const buildings: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    building(1, [mx, my + 0.0002]),   // 구간 바로 옆 (약 20m)
    building(2, [mx + 0.002, my]),    // 구간에서 약 180m 떨어짐
    building(3, [mx, my + 0.0015]),   // 구간 끝에서 약 110m 떨어짐 (60m 밖, 130m 안)
  ],
}

describe('focusZone', () => {
  it('경로 주변 범위의 상자가 경로를 감싼다', () => {
    const zone = focusZone(hb3Path)!
    const [w, s, e, n] = zone.bounds
    expect(w).toBeLessThan(127.3836)
    expect(e).toBeGreaterThan(127.3846)
    expect(s).toBeLessThan(36.3680)
    expect(n).toBeGreaterThan(36.3688)
  })

  it('점이 하나뿐이면 범위가 없다', () => {
    expect(focusZone([[127.38, 36.37]])).toBeNull()
  })
})

describe('nearBuildingIds', () => {
  it('60m 안 건물만 고르고, 범위를 넓히면 늘어난다', () => {
    expect(nearBuildingIds(buildings, focusZone(hb3Path, 60)!)).toEqual([1])
    expect(nearBuildingIds(buildings, focusZone(hb3Path, 130)!)).toEqual([1, 3])
  })

  it('타일 경계에서 조각난 건물은 한 번만 센다', () => {
    const pieces: FeatureCollection = { type: 'FeatureCollection', features: [building(1, [mx, my + 0.0002]), building(1, [mx, my + 0.0002])] }
    expect(nearBuildingIds(pieces, focusZone(hb3Path, 60)!)).toEqual([1])
  })

  it('fid 가 없는 조각은 무시한다', () => {
    const noFid: FeatureCollection = { type: 'FeatureCollection', features: [{ ...building(1, [mx, my]), properties: {} }] }
    expect(nearBuildingIds(noFid, focusZone(hb3Path)!)).toEqual([])
  })
})

describe('veilPolygon', () => {
  it('바깥 사각형과 범위 모양 구멍을 가진다', () => {
    const zone = focusZone(hb3Path)!
    const veil = veilPolygon(MAP_MAX_BOUNDS, zone)
    expect(veil.geometry.coordinates).toHaveLength(2)
    expect(veil.geometry.coordinates[0]).toHaveLength(5)
  })
})

describe('crossingBearing', () => {
  it('동쪽으로 가는 구간은 북쪽을 바라봐서 왼쪽→오른쪽으로 보인다(0도)', () => {
    expect(crossingBearing([[127.38, 36.37], [127.39, 36.37]])).toBeCloseTo(0, 0)
  })

  it('북쪽으로 가는 구간은 서쪽을 바라본다(-90도)', () => {
    expect(crossingBearing([[127.38, 36.37], [127.38, 36.38]])).toBeCloseTo(-90, 0)
  })
})
