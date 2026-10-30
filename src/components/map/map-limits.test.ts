import { describe, expect, it } from 'vitest'
import { maxPitchForZoom } from './map-limits'
import { MAP_MAX_BOUNDS, MAP_MAX_PITCH, MAP_MIN_ZOOM, MAP_PITCH, FOCUS_PITCH } from './map-config'

describe('maxPitchForZoom', () => {
  it('줌 12 이하 35, 14 에서 50, 15.5 이상 60', () => {
    expect(maxPitchForZoom(10.65)).toBe(35)
    expect(maxPitchForZoom(12)).toBe(35)
    expect(maxPitchForZoom(14)).toBe(50)
    expect(maxPitchForZoom(15.5)).toBe(60)
    expect(maxPitchForZoom(18)).toBe(60)
  })

  it('사이 구간은 직선으로 이어진다', () => {
    expect(maxPitchForZoom(13)).toBeCloseTo(42.5)
    expect(maxPitchForZoom(14.75)).toBeCloseTo(55)
  })

  it('줌이 커질수록 줄어들지 않는다', () => {
    let prev = 0
    for (let z = 10; z <= 18; z += 0.1) {
      const v = maxPitchForZoom(z)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('기본 카메라와 구간만 보기 카메라가 제한 안에 있다', () => {
    expect(MAP_PITCH).toBeLessThanOrEqual(MAP_MAX_PITCH)
    expect(FOCUS_PITCH).toBeLessThanOrEqual(MAP_MAX_PITCH)
    expect(maxPitchForZoom(15.2)).toBeLessThan(MAP_PITCH) // 기본 줌(15.2)에서는 처음 60 이 아니라 조금 낮게 시작
  })

  it('이동 범위와 최소 줌이 대전 경계(127.246~127.541, 36.183~36.500)를 넉넉히 포함', () => {
    expect(MAP_MAX_BOUNDS[0]).toBeLessThan(127.246)
    expect(MAP_MAX_BOUNDS[2]).toBeGreaterThan(127.541)
    expect(MAP_MAX_BOUNDS[1]).toBeLessThan(36.183)
    expect(MAP_MAX_BOUNDS[3]).toBeGreaterThan(36.5)
    expect(MAP_MIN_ZOOM).toBeLessThan(12)
  })
})
