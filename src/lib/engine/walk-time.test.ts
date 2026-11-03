import { describe, expect, it } from 'vitest'
import { formatRange, startNodeKind, toRange, walkMinutes } from './walk-time'
import { SPEED_MPS } from './test-fixtures'

describe('walk-time', () => {
  // SPEED_MPS 0.85 = 51 m/분이라 51 m 평지는 1분이다.
  it('walkMinutes: 평지·경사 (경사는 Shimotori 2026 고령 7° 오르막 1.28→1.08 m/s를 올림한 1.2배)', () => {
    expect(walkMinutes(51, SPEED_MPS, { stairs: false, slope: false })).toBeCloseTo(1, 9)
    expect(walkMinutes(51, SPEED_MPS, { stairs: false, slope: true })).toBeCloseTo(1.2, 9)
  })

  it('walkMinutes: 계단 칸 수를 알면 칸마다 시간을 더한다 (Oh-Park 2011 3칸 2.83초 ÷ 3 = 0.94초/칸)', () => {
    // 1.13 m/s(70대 여성), 100 m 구간에 계단 20칸: 계단 수평 20 × 0.28 m = 5.6 m를 뺀 94.4 m는 평지,
    // 계단은 20 × 0.94초 = 18.8초. 94.4 / (1.13 × 60) + 18.8 / 60 = 1.3923 + 0.3133 = 1.7057분
    expect(walkMinutes(100, 1.13, { stairs: true, slope: false, stairsCount: 20 })).toBeCloseTo(1.7057, 3)
    // 경사도 함께면 평지 부분에만 1.2를 곱한다 (계단 시간은 계단 실측이라 따로 곱하지 않는다)
    expect(walkMinutes(100, 1.13, { stairs: true, slope: true, stairsCount: 20 })).toBeCloseTo(1.3923 * 1.2 + 0.3133, 3)
  })

  it('walkMinutes: 천천히·보조기구 상한(0.85 m/s 이하)인 사람은 칸마다 평균+1SD인 1.48초를 쓴다', () => {
    // 51 m 중 20칸 × 0.28 = 5.6 m를 뺀 45.4 m 평지: 45.4 / 51 = 0.8902분, 계단 20 × 1.48 / 60 = 0.4933분
    expect(walkMinutes(51, SPEED_MPS, { stairs: true, slope: false, stairsCount: 20 })).toBeCloseTo(0.8902 + 0.4933, 3)
  })

  it('walkMinutes: 계단 수평 길이가 구간보다 길게 적혀 있으면 평지 부분은 0으로 본다', () => {
    expect(walkMinutes(3, 1.13, { stairs: true, slope: false, stairsCount: 20 })).toBeCloseTo((20 * 0.94) / 60, 6)
  })

  it('walkMinutes: 칸 수 기록이 없으면 임시 배수 2.0 (근거 없음 — 칸 수를 입력하면 칸 시간으로 바뀐다)', () => {
    expect(walkMinutes(51, SPEED_MPS, { stairs: true, slope: false })).toBeCloseTo(2, 9)
    expect(walkMinutes(51, SPEED_MPS, { stairs: true, slope: true })).toBeCloseTo(2.4, 9)
    // 0칸은 기록이 있는 것으로 보고 평지와 같다
    expect(walkMinutes(51, SPEED_MPS, { stairs: true, slope: false, stairsCount: 0 })).toBeCloseTo(1, 9)
  })

  it('toRange·formatRange', () => {
    expect(toRange(10)).toEqual({ base: 10, high: 12 })
    expect(formatRange(toRange(10))).toBe('약 10~12분')
    expect(formatRange({ base: 17, high: 20.3 })).toBe('약 17~21분')
    expect(formatRange({ base: 10, high: 12 })).toBe('약 10~12분')
    expect(formatRange({ base: 28, high: 33.6 })).toBe('약 28~34분')
    expect(formatRange({ base: 5, high: 5 })).toBe('약 5분')
  })

  it('출발 지점은 이동수단에 따라', () => {
    expect(startNodeKind('car')).toBe('parking')
    expect(startNodeKind('taxi')).toBe('parking')
    expect(startNodeKind('bus')).toBe('stop')
    expect(startNodeKind('walk')).toBeNull()
  })
})
