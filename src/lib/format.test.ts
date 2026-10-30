import { describe, expect, it } from 'vitest'
import { stopStairsState } from './format'

const seg = (stairsStatus: 'present' | 'confirmed_none' | 'unknown', reverse = false) => ({ stairsStatus, reverse })

describe('stopStairsState', () => {
  it('계단이 하나라도 있으면 present', () => {
    expect(stopStairsState([seg('confirmed_none'), seg('present')])).toBe('present')
  })

  it('모두 확인된 없음이면 confirmed_none', () => {
    expect(stopStairsState([seg('confirmed_none'), seg('confirmed_none')])).toBe('confirmed_none')
  })

  it('기록 없는 구간이 섞이면 unknown', () => {
    expect(stopStairsState([seg('confirmed_none'), seg('unknown')])).toBe('unknown')
  })

  it('구간이 없으면 unknown', () => {
    expect(stopStairsState([])).toBe('unknown')
  })
})
