import { describe, expect, it } from 'vitest'
import type { PlaceSummary } from '@/lib/contracts'
import { LANDMARKS, landmarkCenter } from '../map/landmarks'
import { MAP_MAX_BOUNDS } from '../map/map-config'
import { buildTourLabels, distanceM, isSamePlace, isValidCoord } from './tour-labels'

type Place = Pick<PlaceSummary, 'id' | 'name' | 'coord' | 'kind'>
const place = (over: Partial<Place> & Pick<Place, 'id' | 'name' | 'coord'>): Place => ({ kind: 'attraction', ...over })

describe('관광지 이름표 목록', () => {
  it('랜드마크 7곳이 먼저, 모두 landmark 강조로 들어간다', () => {
    const labels = buildTourLabels([])
    expect(labels).toHaveLength(LANDMARKS.length)
    expect(labels.every(l => l.emphasis === 'landmark')).toBe(true)
    expect(labels[0].name).toBe(LANDMARKS[0].name)
    expect(labels[0].coord).toEqual(landmarkCenter(LANDMARKS[0]))
  })

  it('관광지는 landmark 뒤에 place 강조로 붙는다', () => {
    const labels = buildTourLabels([place({ id: 'gwanpyeong', name: '관평저수지', coord: [127.3, 36.4] })])
    const last = labels[labels.length - 1]
    expect(last).toMatchObject({ id: 'gwanpyeong', name: '관평저수지', emphasis: 'place' })
  })

  it('관광지가 아닌 종류(식당·카페·숙박)는 뺀다. kind 가 없는 기존 장소는 관광지로 본다', () => {
    const labels = buildTourLabels([
      place({ id: 'food', name: '식당', coord: [127.3, 36.4], kind: 'restaurant' }),
      place({ id: 'cafe', name: '카페', coord: [127.31, 36.4], kind: 'cafe' }),
      place({ id: 'stay', name: '숙소', coord: [127.32, 36.4], kind: 'lodging' }),
      place({ id: 'old', name: '옛 장소', coord: [127.33, 36.4], kind: undefined }),
    ])
    const ids = labels.map(l => l.id)
    expect(ids).not.toContain('food')
    expect(ids).not.toContain('cafe')
    expect(ids).not.toContain('stay')
    expect(ids).toContain('old')
  })

  it('좌표가 이상하거나 대전 밖이거나 이름이 비면 뺀다', () => {
    const labels = buildTourLabels([
      place({ id: 'nan', name: '고장', coord: [Number.NaN, 36.4] }),
      place({ id: 'far', name: '서울', coord: [126.978, 37.566] }),
      place({ id: 'blank', name: '   ', coord: [127.3, 36.4] }),
    ])
    expect(labels.map(l => l.id).filter(id => !LANDMARKS.some(l => l.id === id))).toEqual([])
  })

  it('같은 id 는 한 번만 보인다', () => {
    const labels = buildTourLabels([
      place({ id: 'a', name: '가', coord: [127.3, 36.4] }),
      place({ id: 'a', name: '가', coord: [127.3, 36.4] }),
    ])
    expect(labels.filter(l => l.id === 'a')).toHaveLength(1)
  })

  it('랜드마크와 이름·좌표가 가까운 관광지는 하나만 남긴다', () => {
    // 대전시립미술관: 랜드마크 모형 근처에 같은 이름의 관광지가 있다
    const labels = buildTourLabels([place({ id: 'art', name: '대전시립미술관', coord: [127.385754, 36.36708] })])
    expect(labels.filter(l => l.name.includes('미술관'))).toHaveLength(1)
    expect(labels.some(l => l.id === 'art')).toBe(false)
  })

  it('모형이 대신하는 장소(placeId)는 관광지 목록에서 뺀다', () => {
    const labels = buildTourLabels([place({ id: '한밭수목원', name: '한밭수목원 전혀 다른 이름', coord: [127.5, 36.4] })])
    expect(labels.some(l => l.id === '한밭수목원')).toBe(false)
  })

  it('이름이 달라도 아주 가까운 같은 자리는 한 곳으로 본다', () => {
    const labels = buildTourLabels([place({ id: 'x', name: '전혀 다른 이름', coord: landmarkCenter(LANDMARKS[0]) })])
    expect(labels.some(l => l.id === 'x')).toBe(false)
  })

  it('이름이 같아도 멀리 떨어진 곳은 둘 다 보인다', () => {
    const labels = buildTourLabels([
      place({ id: 'a', name: '둘레길', coord: [127.3, 36.4] }),
      place({ id: 'b', name: '둘레길', coord: [127.33, 36.4] }),
    ])
    expect(labels.map(l => l.id)).toEqual([...LANDMARKS.map(l => l.id), 'a', 'b'])
  })

  it('랜드마크와 이름이 똑같고 1000m 안이면 관광지 이름표를 뺀다 (국립중앙과학관)', () => {
    // 랜드마크 중심과 공유 DB 좌표가 약 332m 떨어진 같은 곳
    const labels = buildTourLabels([place({ id: 'tourapi-14-129785', name: '국립중앙과학관', coord: [127.37905, 36.37595] })])
    expect(labels.some(l => l.id === 'tourapi-14-129785')).toBe(false)
    expect(labels.filter(l => l.name === '국립중앙과학관')).toHaveLength(1)
  })

  it('랜드마크 이름을 포함만 하는 다른 관광지(한밭수목원)는 남긴다', () => {
    // 한밭수목원 본원은 열대식물원 랜드마크와 다른 곳이다. 약 500m 떨어져 있다
    const labels = buildTourLabels([place({ id: 'hanbat', name: '한밭수목원', coord: [127.392562, 36.372284] })])
    expect(labels.some(l => l.id === 'hanbat')).toBe(true)
  })

  it('랜드마크와 이름이 같아도 1000m 넘게 떨어지면 남긴다', () => {
    const labels = buildTourLabels([place({ id: 'far-same', name: '국립중앙과학관', coord: [127.39, 36.37532] })])
    expect(labels.some(l => l.id === 'far-same')).toBe(true)
  })

  it('목록 안의 중복(같은 이름, 같은 자리)은 첫 번째만 남긴다', () => {
    const labels = buildTourLabels([
      place({ id: 'p1', name: '작은 공원', coord: [127.3, 36.4] }),
      place({ id: 'p2', name: '작은공원', coord: [127.3002, 36.4001] }),
    ])
    expect(labels.filter(l => l.emphasis === 'place').map(l => l.id)).toEqual(['p1'])
  })
})

describe('이름표 좌표 검사', () => {
  it('대전 이동 범위 안의 [경도, 위도]만 맞다고 본다', () => {
    const [w, s, e, n] = MAP_MAX_BOUNDS
    expect(isValidCoord([(w + e) / 2, (s + n) / 2])).toBe(true)
    expect(isValidCoord([w - 0.01, (s + n) / 2])).toBe(false)
    expect(isValidCoord([127.3, 36.4, 1])).toBe(false)
    expect(isValidCoord(['127.3', 36.4])).toBe(false)
    expect(isValidCoord([Number.POSITIVE_INFINITY, 36.4])).toBe(false)
  })

  it('거리 계산은 대략 맞다(경도 0.001 도 ≈ 89m, 위도 0.001 도 ≈ 111m)', () => {
    expect(distanceM([127.3, 36.4], [127.301, 36.4])).toBeGreaterThan(85)
    expect(distanceM([127.3, 36.4], [127.3, 36.401])).toBeGreaterThan(108)
    expect(distanceM([127.3, 36.4], [127.3, 36.4])).toBe(0)
  })

  it('같은 장소 판정: 가까우면서 이름이 이어지면 같다', () => {
    expect(isSamePlace({ name: '대전예술의전당', coord: [127.3838, 36.3666] }, { name: '예술의전당', coord: [127.3839, 36.3667] })).toBe(true)
    expect(isSamePlace({ name: '대전예술의전당', coord: [127.3838, 36.3666] }, { name: '한밭수목원', coord: [127.3848, 36.3666] })).toBe(false)
  })
})
