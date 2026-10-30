import { describe, expect, it } from 'vitest'
import { formatRange, startNodeKind, toRange, walkMinutes } from './walk-time'
import { SPEED_MPS } from './test-fixtures'

describe('walk-time', () => {
  it('walkMinutes: 계단·경사 곱하기', () => {
    expect(walkMinutes(51, SPEED_MPS, { stairs: false, slope: false })).toBeCloseTo(1, 9)
    expect(walkMinutes(51, SPEED_MPS, { stairs: true, slope: false })).toBeCloseTo(2, 9)
    expect(walkMinutes(51, SPEED_MPS, { stairs: false, slope: true })).toBeCloseTo(1.5, 9)
    expect(walkMinutes(51, SPEED_MPS, { stairs: true, slope: true })).toBeCloseTo(3, 9)
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
