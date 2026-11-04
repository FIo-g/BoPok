import { describe, expect, it } from 'vitest'
import { findRoute, metersText, routeChip, shortestPath } from './route'
import type { IndoorEdge, IndoorHall, IndoorNode } from './types'

const node = (id: string, kind: IndoorNode['kind'], level: number, verified = true, label = id): IndoorNode => ({ id, kind, level, x: 0.5, y: 0.5, verified, label })

// 1층 입구 → (엘리베이터 | 계단) → 2층 객석. 걷기 구간은 40~70m, 엘리베이터 10~20m, 계단 20~30m(18칸)
const nodes = [
  node('door', 'entrance', 1, true, '정문 로비'),
  node('lift-1', 'elevator', 1, true, '엘리베이터'),
  node('lift-2', 'elevator', 2, true, '엘리베이터'),
  node('stair-1', 'stairs', 1),
  node('stair-2', 'stairs', 2),
  node('seat-1', 'seat', 1),
  node('seat-2', 'seat', 2),
]
const edges: IndoorEdge[] = [
  { from: 'door', to: 'seat-1', kind: 'walk', meters: [30, 50] },
  { from: 'door', to: 'lift-1', kind: 'walk', meters: [40, 70] },
  { from: 'lift-1', to: 'lift-2', kind: 'elevator', meters: [10, 20] },
  { from: 'lift-2', to: 'seat-2', kind: 'walk', meters: [10, 20] },
  { from: 'door', to: 'stair-1', kind: 'walk', meters: [10, 15] },
  { from: 'stair-1', to: 'stair-2', kind: 'stairs', stairs: 18, meters: [20, 30] },
  { from: 'stair-2', to: 'seat-2', kind: 'walk', meters: [5, 10] },
]
const hall = (n: IndoorNode[], e: IndoorEdge[]): IndoorHall => ({
  hallId: 'test', name: '시험홀', planImage: '', explodedImage: '', imageSize: { w: 1, h: 1 }, floors: [], seats: [], nodes: n, edges: e,
})

describe('실내 최단경로', () => {
  it('가장 짧게: 계단을 포함해도 더 짧은 길을 고른다(문→계단→2층 객석)', () => {
    const result = findRoute(hall(nodes, edges), 2, 'shortest')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.route.nodes.map(n => n.id)).toEqual(['door', 'stair-1', 'stair-2', 'seat-2'])
    expect(result.route.stairsCount).toBe(18)
    expect(result.route.meters).toEqual([35, 55])
  })

  it('계단 없이: 계단 구간을 빼고 엘리베이터로 돌아간다', () => {
    const result = findRoute(hall(nodes, edges), 2, 'nostairs')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.route.nodes.map(n => n.id)).toEqual(['door', 'lift-1', 'lift-2', 'seat-2'])
    expect(result.route.stairsCount).toBe(0)
    expect(result.route.stairsUnknown).toBe(false)
    expect(result.route.elevatorTrips).toBe(1)
    expect(result.route.meters).toEqual([60, 110])
  })

  it('같은 층 객석은 걷기만으로 간다', () => {
    const result = findRoute(hall(nodes, edges), 1, 'nostairs')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.route.nodes.map(n => n.id)).toEqual(['door', 'seat-1'])
    expect(result.route.elevatorTrips).toBe(0)
  })

  it('층이 바뀌는 곳마다 구간(leg)을 나눈다', () => {
    const result = findRoute(hall(nodes, edges), 2, 'nostairs')
    if (result.status !== 'ok') throw new Error('ok 여야 한다')
    expect(result.route.legs).toEqual([
      { level: 1, nodeIds: ['door', 'lift-1'] },
      { level: 2, nodeIds: ['lift-2', 'seat-2'] },
    ])
  })

  it('안내 문장: 1. 정문 로비 → 2. 엘리베이터로 2층 → 3. 2층 객석', () => {
    const result = findRoute(hall(nodes, edges), 2, 'nostairs')
    if (result.status !== 'ok') throw new Error('ok 여야 한다')
    expect(result.route.steps).toEqual(['1. 정문 로비', '2. 엘리베이터로 2층', '3. 2층 객석'])
  })

  it('계단 없이 갈 수 없으면 needs-stairs, 계단 경로를 대안으로 준다', () => {
    const onlyStairs = edges.filter(e => e.kind !== 'elevator')
    const result = findRoute(hall(nodes, onlyStairs), 2, 'nostairs')
    expect(result.status).toBe('needs-stairs')
    if (result.status !== 'needs-stairs') return
    expect(result.alternative.stairsCount).toBe(18)
    const chip = routeChip(result)!
    expect(chip.tone).toBe('warn')
    expect(chip.warnings).toContain('계단 없이는 갈 수 없어요')
  })

  it('길이 아예 없으면 blocked', () => {
    expect(findRoute(hall(nodes, []), 2, 'shortest').status).toBe('blocked')
  })

  it('데이터가 비어 있으면(입구나 객석 지점이 없으면) no-data: "실내 경로 정보 준비 중"', () => {
    expect(findRoute(hall([], []), 1, 'nostairs')).toEqual({ status: 'no-data' })
    expect(findRoute(hall([node('door', 'entrance', 1)], []), 1, 'nostairs')).toEqual({ status: 'no-data' })
    expect(findRoute(hall([node('seat-1', 'seat', 1)], []), 1, 'nostairs')).toEqual({ status: 'no-data' })
  })

  it('shortestPath 는 이어지지 않은 곳이면 null', () => {
    expect(shortestPath(new Map(), 'a', 'b')).toBeNull()
  })
})

describe('요약 칩과 경고', () => {
  it('엘리베이터 위치가 확인 전(verified false)이면 주황 + "엘리베이터 위치 확인 필요"', () => {
    const unverified = nodes.map(n => (n.kind === 'elevator' ? { ...n, verified: false } : n))
    const result = findRoute(hall(unverified, edges), 2, 'nostairs')
    const chip = routeChip(result)!
    expect(chip.tone).toBe('warn')
    expect(chip.warnings).toContain('엘리베이터 위치 확인 필요')
    expect(chip.text).toBe('계단 0개 · 엘리베이터 1회 · 약 60~110m(추정)')
  })

  it('모두 확인된 경로는 경고 없이 ok 톤', () => {
    const chip = routeChip(findRoute(hall(nodes, edges), 2, 'nostairs'))!
    expect(chip.tone).toBe('ok')
    expect(chip.warnings).toEqual([])
  })

  it('계단 칸 수를 모르면 "계단 있음(칸 수 확인 전)"', () => {
    const noCount = edges.map(e => (e.kind === 'stairs' ? { ...e, stairs: undefined } : e))
    const chip = routeChip(findRoute(hall(nodes, noCount), 2, 'shortest'))!
    expect(chip.text).toContain('계단 있음(칸 수 확인 전)')
  })

  it('경로가 없으면 칩도 없다', () => {
    expect(routeChip({ status: 'no-data' })).toBeNull()
    expect(routeChip({ status: 'blocked' })).toBeNull()
  })

  it('거리는 범위로만: 약 40~70m(추정), 구간 거리를 모르면 "거리 정보 없음"', () => {
    expect(metersText([40, 70])).toBe('약 40~70m(추정)')
    expect(metersText([40, 40])).toBe('약 40m(추정)')
    expect(metersText(null)).toBe('거리 정보 없음')
    const noMeters = edges.map(e => ({ ...e, meters: undefined }))
    const result = findRoute(hall(nodes, noMeters), 1, 'nostairs')
    if (result.status !== 'ok') throw new Error('ok 여야 한다')
    expect(result.route.meters).toBeNull()
  })
})
