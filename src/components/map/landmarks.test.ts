import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANDMARKS, LANDMARK_FADE_ZOOM, LANDMARK_MATERIAL_COLORS, LANDMARK_SCALE_RANGE, LANDMARK_STYLE, hiddenFids, landmarkCenter, landmarkFade } from './landmarks'
import { MAP_MAX_BOUNDS } from './map-config'

// 대전 경계 안(건물 타일이 있는 범위)
const [west, south, east, north] = MAP_MAX_BOUNDS

describe('랜드마크 고정값', () => {
  it('일곱 곳이고 id 와 모형 파일이 겹치지 않는다', () => {
    expect(LANDMARKS).toHaveLength(7)
    expect(new Set(LANDMARKS.map(l => l.id)).size).toBe(7)
    expect(new Set(LANDMARKS.map(l => l.model)).size).toBe(7)
  })

  it('좌표가 대전 경계 안이다', () => {
    for (const l of LANDMARKS) {
      expect(l.lng).toBeGreaterThan(west)
      expect(l.lng).toBeLessThan(east)
      expect(l.lat).toBeGreaterThan(south)
      expect(l.lat).toBeLessThan(north)
    }
  })

  it('숨길 건물이 비어 있지 않고 곳끼리 겹치지 않는다', () => {
    // 다리·광장처럼 대신할 건물이 없는 곳만 비어 있다
    const NO_BUILDING = ['expo-bridge', 'expo-plaza']
    for (const l of LANDMARKS) {
      if (NO_BUILDING.includes(l.id)) expect(l.hideFids).toEqual([])
      else expect(l.hideFids.length).toBeGreaterThan(0)
      for (const fid of l.hideFids) expect(Number.isInteger(fid) && fid > 0).toBe(true)
    }
    const all = hiddenFids()
    expect(new Set(all).size).toBe(all.length)
  })

  it('scale 은 0.8~2, 방향은 0~360 도', () => {
    for (const l of LANDMARKS) {
      expect(l.scale).toBeGreaterThanOrEqual(LANDMARK_SCALE_RANGE[0])
      expect(l.scale).toBeLessThanOrEqual(LANDMARK_SCALE_RANGE[1])
      expect(l.heightScale).toBeGreaterThanOrEqual(1)
      expect(l.heightScale).toBeLessThanOrEqual(2)
      expect(l.bearingDeg).toBeGreaterThanOrEqual(0)
      expect(l.bearingDeg).toBeLessThan(360)
    }
  })

  it('모형 파일(glb)이 public/models 에 있고 glTF 머리말이 맞다', () => {
    for (const l of LANDMARKS) {
      const file = path.join(__dirname, '../../../public/models', l.model)
      expect(fs.existsSync(file)).toBe(true)
      expect(fs.readFileSync(file).subarray(0, 4).toString('ascii')).toBe('glTF')
    }
  })
})

describe('offsetM 보정', () => {
  it('보정한 중심도 대전 경계 안이고 기준 좌표에서 50m 안이다', () => {
    for (const l of LANDMARKS) {
      expect(Math.abs(l.offsetM[0])).toBeLessThanOrEqual(50)
      expect(Math.abs(l.offsetM[1])).toBeLessThanOrEqual(50)
      const [lng, lat] = landmarkCenter(l)
      expect(lng).toBeGreaterThan(west)
      expect(lng).toBeLessThan(east)
      expect(lat).toBeGreaterThan(south)
      expect(lat).toBeLessThan(north)
    }
  })

  it('landmarkCenter 는 동쪽·북쪽 미터를 경도·위도로 바꿔 더한다', () => {
    const [lng, lat] = landmarkCenter({ lng: 127.38, lat: 36.37, offsetM: [100, 100] })
    expect(lng).toBeCloseTo(127.38 + 100 / (111320 * Math.cos((36.37 * Math.PI) / 180)), 9)
    expect(lat).toBeCloseTo(36.37 + 100 / 110574, 9)
    expect(landmarkCenter({ lng: 127.38, lat: 36.37, offsetM: [0, 0] })).toEqual([127.38, 36.37])
  })

  it('바닥 글로우 반지름용 footprint 긴 변이 양수다', () => {
    for (const l of LANDMARKS) expect(l.footprintLongM).toBeGreaterThan(0)
  })
})

describe('푸른빛 강조 값', () => {
  it('기존 투톤 재질(벽·지붕·유리·녹지) 색이 정해져 있다', () => {
    expect(LANDMARK_MATERIAL_COLORS.green).toBe('#CFE6F4')
    expect(LANDMARK_MATERIAL_COLORS.wall).toBe('#E3EAFB')
    expect(LANDMARK_MATERIAL_COLORS.roof).toBe('#EEF3FE')
    expect(LANDMARK_MATERIAL_COLORS.glass).toBe('#BFD3F8')
  })

  it('숨쉬기는 3초 주기로 0.12~0.22, 호버·선택은 0.3, 글로우는 0.35 → 0.5', () => {
    expect(LANDMARK_STYLE.breathMs).toBe(3000)
    expect([LANDMARK_STYLE.emissiveMin, LANDMARK_STYLE.emissiveMax]).toEqual([0.12, 0.22])
    expect(LANDMARK_STYLE.emissiveActive).toBe(0.3)
    expect([LANDMARK_STYLE.glowAlpha, LANDMARK_STYLE.glowAlphaActive]).toEqual([0.35, 0.5])
    expect(LANDMARK_STYLE.glowRadiusRatio).toBe(0.75)
  })
})

describe('landmarkFade', () => {
  const [z0, z1] = LANDMARK_FADE_ZOOM
  it('줌 14.5 미만은 0, 15.5 이상은 1, 사이는 서서히', () => {
    expect([z0, z1]).toEqual([14.5, 15.5])
    expect(landmarkFade(14)).toBe(0)
    expect(landmarkFade(z0)).toBe(0)
    expect(landmarkFade(15)).toBeCloseTo(0.5)
    expect(landmarkFade(z1)).toBe(1)
    expect(landmarkFade(18)).toBe(1)
  })
})
