import { describe, expect, it } from 'vitest'
import { estimateCosts } from './cost'

describe('한 사람 기준 비용과 여유 20%', () => {
  it('개인 입장·식비와 함께 내는 숙박·택시를 구분해 계산한다', () => {
    const result = estimateCosts({ partySize: 4, charges: [
      { stopKey: 'a', kind: 'admission', amountKrw: 5000, unit: 'per_person' },
      { stopKey: 'b', kind: 'meal', amountKrw: 13000, unit: 'per_person' },
      { stopKey: 'c', kind: 'lodging', amountKrw: 120000, unit: 'shared' },
      { stopKey: 'b', kind: 'taxi', amountKrw: 11000, unit: 'shared' },
    ] })
    expect(result.perPersonKrw).toEqual({ low: 50750, high: 60900 })
    expect(result.items.map(item => item.krw)).toEqual([5000, 13000, 30000, 2750])
    expect(result.bufferRate).toBe(0.2)
  })

  it('객실 수·박 수 등의 수량을 반영하고 공유 비용은 원 단위로 올린다', () => {
    expect(estimateCosts({ partySize: 3, charges: [
      { stopKey: null, kind: 'other', amountKrw: 10000, quantity: 2, unit: 'shared' },
    ] }).perPersonKrw).toEqual({ low: 6667, high: 8000 })
  })

  it.each([0, -1, 1.5])('잘못된 일행 수 %s를 거부한다', partySize => {
    expect(() => estimateCosts({ partySize, charges: [] })).toThrow()
  })

  it('빈 항목은 합계 0이고, 미확인 금액 null은 무료로 바꾸지 않는다', () => {
    expect(estimateCosts({ partySize: 1, charges: [] }).perPersonKrw).toEqual({ low: 0, high: 0 })
    expect(() => estimateCosts({ partySize: 1, charges: [
      { stopKey: 'a', kind: 'meal', amountKrw: null, unit: 'per_person' },
    ] })).toThrow()
  })
})
