import { describe, expect, it, vi } from 'vitest'
import type { PlaceDetail, PlaceKind, PlaceRecommendationResponse } from '@/lib/contracts'
import { fillRouteServices } from './route-services'

const place = (id: string, kind: PlaceKind, x = 127.38): PlaceDetail => ({ id, name: id, kind, category: kind, coord: [x, 36.35], styles: [], seated: kind === 'restaurant' || kind === 'cafe', indoor: false, confidence: 'B', nodes: [], segments: [] })
const spot = place('관광지', 'attraction')
const meal = { placeId: null, name: '점심 식사', seated: true }
const response = (p: PlaceDetail, distanceM = 100): PlaceRecommendationResponse => ({ catalogReady: true, method: 'keyword', distanceBasis: 'straight_line', routeCheckRequired: true, items: [{ place: p, menus: [], distanceM }] })
const options = { details: [spot], transport: 'car' as const }
describe('AI 동선의 식사·숙박 연결', () => {
  it('빈 점심 자리를 가까운 등록 식당으로 바꾸며 좌표·종류를 DB에서 가져온다', async () => {
    const recommend = vi.fn(async () => response(place('등록식당', 'restaurant')))
    const out = await fillRouteServices([{ placeId: spot.id, name: spot.name }, meal], options, recommend)
    expect(out[1]).toMatchObject({ placeId: '등록식당', name: '등록식당', seated: true })
    expect(recommend).toHaveBeenCalledWith(expect.objectContaining({ kind: 'restaurant', near: spot.coord, query: '' }))
    expect(out[1]).not.toHaveProperty('startTime')
  })
  it('당일 여행에는 숙박을 추가하지 않고 여러 날은 마지막 날 전까지만 추가한다', async () => {
    const recommend = vi.fn(async () => response(place('등록숙소', 'lodging')))
    expect(await fillRouteServices([{ placeId: spot.id, name: spot.name }], options, recommend)).toHaveLength(1)
    const out = await fillRouteServices([{ placeId: spot.id, name: spot.name }, { placeId: spot.id, name: spot.name, day: 2 }],
      { ...options, overnightDays: [1] }, recommend)
    expect(out.map(draft => draft.placeId)).toEqual([spot.id, '등록숙소', spot.id])
    expect(out[1].day).toBe(1)
  })
  it('직접 고른 식당·예약·꼭 갈 곳과 좌표를 직접 정한 자리는 보존한다', async () => {
    const recommend = vi.fn(async () => response(place('다른식당', 'restaurant')))
    const original = [{ placeId: spot.id, name: spot.name }, { ...meal, placeId: '선택식당' },
      { ...meal, mustVisit: true }, { ...meal, reservedAt: '12:00' }, { ...meal, coord: spot.coord }]
    expect(await fillRouteServices(original, options, recommend)).toEqual(original)
    expect(recommend).not.toHaveBeenCalled()
  })
  it('같은 날의 앞뒤 방문지만 경로 기준으로 사용한다', async () => {
    const next = place('다음관광지', 'attraction', 127.39)
    const recommend = vi.fn(async () => response(place('동선식당', 'restaurant')))
    await fillRouteServices([{ placeId: spot.id, name: spot.name }, meal, { placeId: next.id, name: next.name }],
      { ...options, details: [spot, next] }, recommend)
    expect(recommend).toHaveBeenCalledWith(expect.objectContaining({ route: [spot.coord, next.coord] }))
  })
  it('멀거나 종류가 다르거나 실패한 후보는 넣지 않는다', async () => {
    const drafts = [{ placeId: spot.id, name: spot.name }, meal]
    for (const recommend of [async () => response(place('먼식당', 'restaurant'), 6000),
      async () => response(place('다른종류', 'cafe')), async () => { throw Error('가상 장애') }]) {
      expect(await fillRouteServices(drafts, options, recommend)).toEqual(drafts)
    }
  })
  it('대중교통은 먼 도보 우회를 피하고 중복 장소를 넣지 않는다', async () => {
    const recommend = async () => response(place('먼식당', 'restaurant'), 1600)
    const drafts = [{ placeId: spot.id, name: spot.name }, meal]
    expect(await fillRouteServices(drafts, { ...options, transport: 'transit' }, recommend)).toEqual(drafts)
    const selected = place('선택식당', 'restaurant')
    expect(await fillRouteServices([{ placeId: selected.id, name: selected.name }, meal],
      { ...options, details: [selected] }, async () => response(selected))).toEqual([{ placeId: selected.id, name: selected.name }, meal])
  })
  it('좌표가 없는 일정은 외부 조회 없이 빈 자리를 유지한다', async () => {
    const recommend = vi.fn(async () => response(place('식당', 'restaurant')))
    expect(await fillRouteServices([meal], options, recommend)).toEqual([meal])
    expect(recommend).not.toHaveBeenCalled()
  })
  it('피할 음식 태그가 확인된 후보는 자동 배치하지 않고 미확인을 안전으로 표시하지 않는다', async () => {
    const result = response(place('태그확인식당', 'restaurant'))
    result.items[0].menus = [{ name: '확인 메뉴', foodTags: ['salty'], confidence: 'B' }]
    result.items.push(response(place('태그미확인식당', 'restaurant')).items[0])
    const out = await fillRouteServices([{ placeId: spot.id, name: spot.name }, meal],
      { ...options, avoidFoodTags: ['salty'] }, async () => result)
    expect(out[1].placeId).toBe('태그미확인식당')
    expect(out[1]).not.toHaveProperty('dietSafe')
  })
})
