import { describe, expect, it } from 'vitest'
import { judge } from '@/lib/engine'
import type { Stop, Traveler } from '@/lib/contracts'
import { mockPlaces } from '@/mocks/places'
import { buildPins, buildRouteGeoJSON, gapItemId } from './map-geojson'

const traveler: Traveler = { id: 't', label: '엄마', pace: 'unknown', mobilityAid: false, isParent: true, condition: {}, filledBySelf: false }
const stop = (key: string, placeId: string, arriveBy: Stop['arriveBy']): Stop => ({ key, placeId, name: key, startTime: '10:00', visitMin: 60, mustVisit: false, arriveBy, skipSegmentIds: [], detourMap: {}, restNodeIds: [] })

describe('경로선이 없는 장소 사이', () => {
  const stops = [stop('s1', 'hanbat', 'car'), stop('s2', 'science', 'taxi')]
  // 경로를 하나도 받지 못한 상태(legs 비어 있음)
  const data = { stops, places: mockPlaces, legs: {}, result: judge({ travelers: [traveler], stops, places: mockPlaces, legs: {} }) }

  it('다음 장소까지 점선(ride)으로 잇는다', () => {
    const gap = buildRouteGeoJSON(data).features.find(f => f.properties.itemId === gapItemId('s1', 's2'))
    expect(gap?.properties.role).toBe('ride')
    expect(gap?.geometry.coordinates).toEqual([mockPlaces.hanbat.coord, mockPlaces.science.coord])
  })

  it('가운데에 이동수단과 "경로 정보 없음"을 붙인다', () => {
    const link = buildPins(data).find(p => p.kind === 'link')
    expect(link?.label).toBe('택시 · 경로 정보 없음')
  })

  it('좌표 없는 식사 자리가 사이에 끼어도 앞뒤 장소를 잇는다', () => {
    const meal: Stop = { ...stop('meal', '', 'car'), placeId: null }
    const three = [stop('s1', 'hanbat', 'car'), meal, stop('s2', 'science', 'taxi')]
    const withMeal = { ...data, stops: three }
    const gap = buildRouteGeoJSON(withMeal).features.find(f => f.properties.itemId === gapItemId('s1', 's2'))
    expect(gap?.geometry.coordinates).toEqual([mockPlaces.hanbat.coord, mockPlaces.science.coord])
    expect(buildPins(withMeal).filter(p => p.kind === 'link').map(p => p.label)).toEqual(['택시 · 경로 정보 없음'])
  })

  it('장소가 하나면 잇지 않는다', () => {
    const one = { ...data, stops: [stops[0]] }
    expect(buildRouteGeoJSON(one).features.some(f => f.properties.itemId.startsWith('gap:'))).toBe(false)
    expect(buildPins(one).some(p => p.kind === 'link')).toBe(false)
  })
})

describe('안내도 번호 핀', () => {
  it('번호가 있는 볼거리만 안내도 번호로 달린다', () => {
    const place = { ...mockPlaces.hanbat, nodes: [
      ...mockPlaces.hanbat.nodes,
      { id: 'g1', placeId: 'hanbat', kind: 'sight' as const, name: '열대식물원', restType: null, coord: [127.38, 36.36] as [number, number], guideNo: 3 },
      { id: 'g2', placeId: 'hanbat', kind: 'sight' as const, name: '번호 없음', restType: null, coord: [127.38, 36.36] as [number, number] },
    ] }
    const stops = [stop('s1', 'hanbat', 'car')]
    const places = { ...mockPlaces, hanbat: place }
    const data = { stops, places, legs: {}, result: judge({ travelers: [traveler], stops, places, legs: {} }) }
    const guide = buildPins(data).filter(p => p.kind === 'guide')
    expect(guide.map(p => [p.text, p.label])).toEqual([['3', '3. 열대식물원']])
  })
})
