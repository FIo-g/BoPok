import { describe, expect, it, vi } from 'vitest'
import { legKey, type LegRequest, type PlaceDetail } from '@/lib/contracts'
import { quoteTaxiCosts } from './taxi-cost'

const from: PlaceDetail = { id: 'a', name: '가상 출발지', category: '관광지', styles: [], coord: [127.38, 36.35],
  seated: false, indoor: false, address: '대전광역시 서구 가상 주소', confidence: 'B', nodes: [], segments: [] }
const to: PlaceDetail = { ...from, id: 'b', name: '가상 도착지', coord: [127.39, 36.35] }
const request: LegRequest = { from: { placeId: 'a', coord: from.coord }, to: { placeId: 'b', coord: to.coord }, mode: 'taxi' }
describe('등록된 대전 장소의 택시 비용', () => {
  it('TMAP이 돌려준 실제 경로 거리에만 운임 기준을 적용한다', async () => {
    const route = vi.fn(async () => [{ key: legKey(request), mode: 'taxi' as const, distanceM: 1775,
      durationMin: 3, path: [from.coord, to.coord], stairsStatus: 'unknown' as const, confidence: 'B' as const }])
    const result = await quoteTaxiCosts({ requests: [request] }, { details: async () => [from, to], route })
    expect(result[0]).toMatchObject({ fareKrw: 4900, distanceM: 1775, basis: 'distance_only' })
    expect(result[0].exclusions).toContain('정체·저속 시간 요금')
    expect(route).toHaveBeenCalledOnce()
  })
  it('등록 장소와 다른 좌표 또는 대전 밖이면 외부 경로를 호출하지 않는다', async () => {
    const route = vi.fn()
    await expect(quoteTaxiCosts({ requests: [{ ...request, from: { ...request.from, coord: [127.0, 37.0] } }] }, {
      details: async () => [from, to], route,
    })).rejects.toThrow('대전')
    await expect(quoteTaxiCosts({ requests: [request] }, {
      details: async () => [{ ...from, address: '서울특별시 가상 주소' }, to], route,
    })).rejects.toThrow('대전')
    expect(route).not.toHaveBeenCalled()
  })
})
