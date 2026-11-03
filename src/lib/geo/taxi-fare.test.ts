import { describe, expect, it } from 'vitest'
import { estimateDaejeonTaxiFare } from './taxi-fare'

describe('대전 중형택시 요금 추정', () => {
  it.each([[0, 4800], [1650, 4800], [1651, 4900], [1775, 4900], [1776, 5000], [2900, 5800]])(
    '%sm의 거리 기준 요금은 %s원이다', (distanceM, fareKrw) => {
      expect(estimateDaejeonTaxiFare({ distanceM })).toMatchObject({ fareKrw, basis: 'distance_only', effectiveFrom: '2026-11-01' })
    },
  )
  it('저속 시간이 실제 입력된 때만 시간 요금을 더한다', () => {
    expect(estimateDaejeonTaxiFare({ distanceM: 1650, slowSeconds: 29 }).fareKrw).toBe(4900)
    expect(estimateDaejeonTaxiFare({ distanceM: 1650 }).exclusions).toContain('정체·저속 시간 요금')
  })
  it('음수·미확인 거리를 임의의 요금으로 만들지 않는다', () => {
    expect(() => estimateDaejeonTaxiFare({ distanceM: -1 })).toThrow()
    expect(() => estimateDaejeonTaxiFare({ distanceM: null })).toThrow()
  })
})
