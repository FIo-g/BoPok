import { describe, expect, it } from 'vitest'
import {
  ADULT_SPEED_TABLE,
  CHILD_SPEED_TABLE,
  DEFAULT_CONDITION,
  HEIGHT_REF_CM,
  MARGIN_RATE,
  MOBILITY_AID_CAP_MPS,
  SLOPE_WEIGHT,
  SLOW_CAP_MPS,
  STAIR_STEP_SEC,
  STAIR_STEP_SEC_SLOW,
  STAIR_TREAD_M,
  STAIRS_WEIGHT,
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
  // 근거 값 (B1·B2·B3·B6 조사, 2026-11-03). 값을 바꾸면 constants.ts 주석의 서지와 설계 7.1·7.2도 고친다.
  it('계단: 칸당 0.94초(Oh-Park 2011 내려가기 2.83초 ÷ 3), 느린 사람 1.48초((2.83+1.61) ÷ 3), 디딤 0.28 m', () => {
    expect(STAIR_STEP_SEC).toBeCloseTo(2.83 / 3, 2)
    expect(STAIR_STEP_SEC_SLOW).toBeCloseTo((2.83 + 1.61) / 3, 2)
    expect(STAIR_TREAD_M).toBe(0.28)
    expect(STAIRS_WEIGHT).toBe(2.0) // 칸 수가 없을 때만 쓰는 임시 값
  })
  it('경사 1.2배: Shimotori 2026 고령 오르막 1.28/1.08 = 1.185, 내리막 1.28/1.11 = 1.153 중 큰 쪽을 올림', () => {
    expect(SLOPE_WEIGHT).toBe(1.2)
    expect(SLOPE_WEIGHT).toBeGreaterThanOrEqual(1.28 / 1.08)
  })
  it('여유율 0.2 유지 (B3)', () => {
    expect(MARGIN_RATE).toBe(0.2)
  })
  it('키 보정 기준: 한국 노인 평균 키 여 152 · 남 165 cm (사이즈코리아 2022 70~84세, 국민체력100 65세 이상)', () => {
    expect(HEIGHT_REF_CM).toEqual({ female: 152, male: 165 })
  })
  it('상한은 보조기구 < 천천히', () => {
    expect(MOBILITY_AID_CAP_MPS).toBeLessThan(SLOW_CAP_MPS)
  })
})
