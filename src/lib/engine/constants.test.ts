import { describe, expect, it } from 'vitest'
import {
  ADULT_SPEED_TABLE,
  CHILD_SPEED_TABLE,
  DEFAULT_CONDITION,
  MOBILITY_AID_CAP_MPS,
  SLOW_CAP_MPS,
} from './constants'

describe('constants', () => {
  it('성인 표는 나이 오름차순, 18세부터', () => {
    expect(ADULT_SPEED_TABLE.map((r) => r.minAge)).toEqual([18, 30, 40, 50, 60, 70, 80])
  })
  it('70대 여성 1.13, 80세 이상 남성 1.05 m/s', () => {
    expect(ADULT_SPEED_TABLE[5].femaleMps).toBe(1.13)
    expect(ADULT_SPEED_TABLE[6].maleMps).toBe(1.05)
  })
  it('아동 표는 0세부터 오름차순', () => {
    expect(CHILD_SPEED_TABLE.map((r) => r.minAge)).toEqual([0, 5, 7, 9, 11, 14])
  })
  it('기본 조건은 20/60/10분, 계단 피하기', () => {
    expect(DEFAULT_CONDITION).toEqual({
      continuousMin: 20,
      dayMin: 60,
      restMin: 10,
      avoidStairs: true,
    })
  })
  it('상한은 보조기구 < 천천히', () => {
    expect(MOBILITY_AID_CAP_MPS).toBeLessThan(SLOW_CAP_MPS)
  })
})
