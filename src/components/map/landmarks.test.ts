import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANDMARKS, LANDMARK_FADE_ZOOM, LANDMARK_MATERIAL_COLORS, LANDMARK_SCALE_RANGE, LANDMARK_STYLE, hiddenFids, landmarkById, landmarkCenter, landmarkFade, landmarkRectCoords, landmarkViewBearing } from './landmarks'
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

describe('상세 화면 데이터', () => {
  it('모든 랜드마크에 사진·설명·동네·칩(최대 3개)이 있다', () => {
    for (const l of LANDMARKS) {
      expect(l.image).toBe(`/images/landmarks/${l.id}.webp`)
      expect(l.imageAlt.length).toBeGreaterThan(0)
      expect(l.summary.length).toBeGreaterThan(10)
      expect(l.area).toContain('·')
      expect(l.tags.length).toBeGreaterThan(0)
      expect(l.tags.length).toBeLessThanOrEqual(3)
    }
  })

  it('사진 파일이 있고 300KB 이하다', () => {
    for (const l of LANDMARKS) {
      const file = path.join(__dirname, '../../../public', l.image)
      expect(fs.existsSync(file)).toBe(true)
      expect(fs.statSync(file).size).toBeLessThanOrEqual(300 * 1024)
    }
  })

  it('카메라 줌은 기본 17.3, 큰 곳(다리·광장)은 16.6', () => {
    for (const l of LANDMARKS) expect(l.detailZoom).toBe(['expo-bridge', 'expo-plaza'].includes(l.id) ? 16.6 : 17.3)
  })

  it('landmarkById 는 id 로 찾고 없으면 undefined', () => {
    expect(landmarkById('expo-bridge')?.name).toBe('엑스포다리')
    expect(landmarkById('nope')).toBeUndefined()
    expect(landmarkById(null)).toBeUndefined()
  })

  it('정면 방향은 모형 앞(+Z)을 마주 보는 bearingDeg - 90, 직접 정한 값이 있으면 그 값', () => {
    expect(landmarkViewBearing({ bearingDeg: 90 })).toBe(0)
    expect(landmarkViewBearing({ bearingDeg: 0 })).toBe(270)
    expect(landmarkViewBearing({ bearingDeg: 355.8 })).toBe(265.8)
    expect(landmarkViewBearing({ bearingDeg: 90, viewBearingDeg: 45 })).toBe(45)
  })

  it('다리·광장만 미니맵 도형이 있고, 모서리 5개로 닫힌 직사각형이다', () => {
    for (const l of LANDMARKS) expect(landmarkRectCoords(l) !== null).toBe(l.hideFids.length === 0)
    const ring = landmarkRectCoords(landmarkById('expo-bridge')!)!
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
    // 남북으로 놓인 다리(bearing 0): 위도 폭이 길고 경도 폭이 좁다
    const lngs = ring.map(c => c[0])
    const lats = ring.map(c => c[1])
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan((Math.max(...lngs) - Math.min(...lngs)) * 5)
  })
})

describe('설명의 출처와 근거 (AGENTS.md 6장)', () => {
  it('모든 랜드마크에 출처·확인 날짜(YYYY-MM-DD)·신뢰 등급(A/B/C)이 있다', () => {
    for (const l of LANDMARKS) {
      expect(l.source.trim().length).toBeGreaterThan(0)
      expect(l.checkedAt).toMatch(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/)
      expect(['A', 'B', 'C']).toContain(l.confidence)
    }
  })

  it('위치가 추정인 곳(도서관·시민광장)에는 위치 안내가 붙어 있다', () => {
    for (const id of ['ibs-library', 'expo-plaza']) expect(landmarkById(id)?.locationNote).toBeTruthy()
    expect(landmarkById('art-museum')?.locationNote).toBeUndefined()
  })

  it('근거 없는 이동 판단 문구(그늘·쉬어가기·걸어서 이어짐·보행 전용·날씨 무관 등)가 설명과 칩에 없다', () => {
    const banned = ['그늘', '쉬어가기', '쉬기 좋', '걸어서', '보행 전용', '날씨 무관', '이동 거리', '동선', '로비 휴식', '공원 연결']
    for (const l of LANDMARKS) {
      const text = [l.summary, ...l.tags].join(' ')
      for (const word of banned) expect(text, `${l.id}: ${word}`).not.toContain(word)
    }
  })

  it('이미지 설명(alt)은 실제 사진이라고 단정하지 않고 "이미지"라고 쓴다', () => {
    for (const l of LANDMARKS) {
      expect(l.imageAlt).toContain('이미지')
      expect(l.imageAlt).not.toContain('사진')
    }
  })
})
