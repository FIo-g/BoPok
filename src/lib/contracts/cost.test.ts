import { describe, expect, it } from 'vitest'
import { CostEstimateSchema, CostItemKindSchema, CostItemSchema } from './index'

// 한 사람 기준. low = 항목 합계(50000), high = round(low × (1 + bufferRate)) = 60000
const estimate = {
  perPersonKrw: { low: 50000, high: 60000 },
  items: [
    { stopKey: 's1', kind: 'admission', krw: 5000 },
    { stopKey: 's2', kind: 'meal', krw: 12000 },
    { stopKey: 's3', kind: 'taxi', krw: 3000 },
    { stopKey: 's4', kind: 'lodging', krw: 15000 }, // 숙박은 그날 마지막 Stop(숙박 장소)에 붙는다
    { stopKey: null, kind: 'other', krw: 15000 }, // 일정 전체 비용 (KTX 왕복표)
  ],
  bufferRate: 0.2,
}

describe('비용 추정', () => {
  it('정상 예시는 통과', () => {
    expect(CostEstimateSchema.safeParse(estimate).success).toBe(true)
  })

  it('낮은 값과 높은 값이 같아도 통과', () => {
    expect(CostEstimateSchema.safeParse({ ...estimate, perPersonKrw: { low: 50000, high: 50000 } }).success).toBe(true)
  })

  it('low가 high보다 크면 거부 (오류 위치는 perPersonKrw)', () => {
    const result = CostEstimateSchema.safeParse({ ...estimate, perPersonKrw: { low: 60001, high: 60000 } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual(['perPersonKrw'])
  })

  it('bufferRate는 0~1', () => {
    expect(CostEstimateSchema.safeParse({ ...estimate, bufferRate: 0 }).success).toBe(true)
    expect(CostEstimateSchema.safeParse({ ...estimate, bufferRate: 1 }).success).toBe(true)
    expect(CostEstimateSchema.safeParse({ ...estimate, bufferRate: -0.1 }).success).toBe(false)
    expect(CostEstimateSchema.safeParse({ ...estimate, bufferRate: 1.5 }).success).toBe(false)
  })

  it('원은 0 이상의 정수', () => {
    expect(CostItemSchema.safeParse({ stopKey: 's1', kind: 'meal', krw: 0 }).success).toBe(true)
    expect(CostItemSchema.safeParse({ stopKey: 's1', kind: 'meal', krw: -1 }).success).toBe(false)
    expect(CostItemSchema.safeParse({ stopKey: 's1', kind: 'meal', krw: 1200.5 }).success).toBe(false)
    expect(CostEstimateSchema.safeParse({ ...estimate, perPersonKrw: { low: -1, high: 100 } }).success).toBe(false)
    expect(CostEstimateSchema.safeParse({ ...estimate, perPersonKrw: { low: 100, high: 100.5 } }).success).toBe(false)
  })

  it('항목 종류는 정해진 다섯 가지', () => {
    expect(CostItemKindSchema.options).toEqual(['admission', 'meal', 'taxi', 'lodging', 'other'])
    expect(CostItemSchema.safeParse({ stopKey: 's1', kind: 'shopping', krw: 100 }).success).toBe(false)
  })

  it('stopKey는 null이어도 되지만 빠지면 거부 (일정 전체 비용은 null로 적는다)', () => {
    expect(CostItemSchema.safeParse({ stopKey: null, kind: 'other', krw: 30000 }).success).toBe(true) // KTX 왕복표
    expect(CostItemSchema.safeParse({ kind: 'other', krw: 30000 }).success).toBe(false)
  })
})
