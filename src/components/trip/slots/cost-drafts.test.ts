import { describe, expect, it } from 'vitest'
import type { Stop } from '@/lib/contracts'
import { applyUneditedQuotes, costScope, placeCostKey, taxiCostKey } from './cost-drafts'

const stop: Stop = { key: 'stop-1', placeId: 'art', name: '미술관', arriveBy: 'taxi',
  mustVisit: false, skipSegmentIds: [], detourMap: {}, restNodeIds: [] }
const next: Stop = { ...stop, key: 'stop-2', placeId: 'leeungno' }
const scope = costScope('trip', 'version-1', 1)

describe('비용 입력의 일정·장소 경계', () => {
  it('다른 여행·버전·일차에는 이전 금액을 연결하지 않는다', () => {
    const id = placeCostKey(scope, stop)
    for (const other of [costScope('other', 'version-1', 1), costScope('trip', 'version-2', 1), costScope('trip', 'version-1', 2)]) {
      expect(placeCostKey(other, stop)).not.toBe(id)
    }
  })
  it('장소나 미등록 장소 좌표를 바꾸면 금액을 새로 확인한다', () => {
    expect(placeCostKey(scope, { ...stop, placeId: 'hanbat' })).not.toBe(placeCostKey(scope, stop))
    const unlisted = { ...stop, placeId: null, coord: [127.38, 36.35] as [number, number] }
    expect(placeCostKey(scope, { ...unlisted, coord: [127.39, 36.35] })).not.toBe(placeCostKey(scope, unlisted))
  })
  it('시간만 고치면 확인한 가격을 유지한다', () => {
    expect(placeCostKey(scope, { ...stop, startTime: '11:00' })).toBe(placeCostKey(scope, stop))
    expect(taxiCostKey(scope, { ...stop, startTime: '11:00' }, next, 3)).toBe(taxiCostKey(scope, stop, next, 3))
  })
  it('택시 출발지·도착지·방향·일행 수·내부 동선 변경은 구분한다', () => {
    const id = taxiCostKey(scope, stop, next, 3)
    expect(taxiCostKey(scope, { ...stop, placeId: 'hanbat' }, next, 3)).not.toBe(id)
    expect(taxiCostKey(scope, stop, { ...next, placeId: 'hanbat' }, 3)).not.toBe(id)
    expect(taxiCostKey(scope, next, stop, 3)).not.toBe(id)
    expect(taxiCostKey(scope, stop, next, 5)).not.toBe(id)
    expect(taxiCostKey(scope, { ...stop, restNodeIds: ['rest'] }, next, 3)).not.toBe(id)
  })
  it('택시 조회 중 직접 고친 값은 보존하고 수정하지 않은 행에만 견적을 넣는다', () => {
    const requested = { edited: { amount: '4800' }, untouched: { amount: '' } }
    const current = { ...requested, edited: { amount: '7000' }, added: { amount: '3000' } }
    const result = applyUneditedQuotes(current, requested, { edited: { amount: '4900' }, untouched: { amount: '5100' } })
    expect(result).toEqual({ edited: { amount: '7000' }, untouched: { amount: '5100' }, added: { amount: '3000' } })
    expect(current.untouched.amount).toBe('')
  })
})
