// 입구에서 객석까지의 실내 경로(시연용 그래프). 순수 함수라 테스트로 값을 고정한다.
// 거리는 구간 범위(m)를 더해 "약 40~70m(추정)"처럼 범위로만 쓰고, 숫자를 새로 만들지 않는다(AGENTS.md 6장).
import { INDOOR_KIND_TEXT, type IndoorEdge, type IndoorHall, type IndoorNode } from './types'

export type RouteMode = 'nostairs' | 'shortest'

export type RouteLeg = { level: number; nodeIds: string[] }

export type RouteFound = {
  nodes: IndoorNode[]
  edges: IndoorEdge[]
  // 같은 층에서 걷는 구간 묶음(층이 바뀌는 곳마다 나뉜다). 애니메이션이 층마다 이어서 그린다
  legs: RouteLeg[]
  stairsCount: number
  // 계단 구간이 있는데 칸 수를 모르는 경우
  stairsUnknown: boolean
  elevatorTrips: number
  // 지나는 엘리베이터 지점의 위치가 확인 전
  elevatorUnverified: boolean
  // 구간 거리 범위의 합. 하나라도 거리를 모르면 null
  meters: [number, number] | null
  steps: string[]
}

export type RouteResult =
  | { status: 'no-data' } // 입구나 도착 객석 지점이 아직 없다 → "실내 경로 정보 준비 중"
  | { status: 'blocked' } // 이어진 길이 없다
  | { status: 'needs-stairs'; alternative: RouteFound } // 계단 없이는 갈 수 없고, 계단을 쓰면 갈 수 있다
  | { status: 'ok'; route: RouteFound }

// 거리를 모르는 구간의 길찾기용 가중치(가장 짧은 길을 고를 때만 쓰고 화면에는 내지 않는다)
const UNKNOWN_WEIGHT = 30

const mid = (e: IndoorEdge) => (e.meters ? (e.meters[0] + e.meters[1]) / 2 : UNKNOWN_WEIGHT)

type Adj = Map<string, { to: string; edge: IndoorEdge }[]>

function buildAdjacency(edges: IndoorEdge[], allowStairs: boolean): Adj {
  const adj: Adj = new Map()
  const add = (a: string, b: string, edge: IndoorEdge) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push({ to: b, edge })
  }
  for (const edge of edges) {
    if (edge.kind === 'stairs' && !allowStairs) continue
    add(edge.from, edge.to, edge)
    add(edge.to, edge.from, edge)
  }
  return adj
}

// 가장 짧은 길(다익스트라). 노드가 적어서 배열에서 최솟값을 고르는 단순한 구현으로 충분하다
export function shortestPath(adj: Adj, from: string, to: string): { ids: string[]; edges: IndoorEdge[] } | null {
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, { id: string; edge: IndoorEdge }>()
  const open = new Set<string>([from])
  const done = new Set<string>()
  while (open.size > 0) {
    let current = ''
    let best = Infinity
    for (const id of open) {
      const d = dist.get(id) ?? Infinity
      if (d < best) {
        best = d
        current = id
      }
    }
    if (current === to) break
    open.delete(current)
    done.add(current)
    for (const { to: next, edge } of adj.get(current) ?? []) {
      if (done.has(next)) continue
      const d = best + mid(edge)
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d)
        prev.set(next, { id: current, edge })
        open.add(next)
      }
    }
  }
  if (!dist.has(to)) return null
  const ids = [to]
  const edges: IndoorEdge[] = []
  for (let at = to; at !== from; ) {
    const p = prev.get(at)
    if (!p) return null
    edges.unshift(p.edge)
    ids.unshift(p.id)
    at = p.id
  }
  return { ids, edges }
}

function describe(hall: IndoorHall, ids: string[], edges: IndoorEdge[]): RouteFound {
  const byId = new Map(hall.nodes.map(n => [n.id, n]))
  const nodes = ids.map(id => byId.get(id)!)
  // 층이 바뀔 때마다 구간을 나눈다
  const legs: RouteLeg[] = []
  for (const node of nodes) {
    const last = legs[legs.length - 1]
    if (last && last.level === node.level) last.nodeIds.push(node.id)
    else legs.push({ level: node.level, nodeIds: [node.id] })
  }
  const stairsEdges = edges.filter(e => e.kind === 'stairs')
  const elevatorEdges = edges.filter(e => e.kind === 'elevator')
  const hasMeters = edges.every(e => e.meters)
  const steps: string[] = [`${nodes[0].label}`]
  edges.forEach((edge, i) => {
    if (edge.kind === 'walk') return
    const to = byId.get(ids[i + 1])!
    steps.push(`${edge.kind === 'elevator' ? '엘리베이터' : '계단'}로 ${to.level}층`)
  })
  const dest = nodes[nodes.length - 1]
  steps.push(`${dest.level}층 ${INDOOR_KIND_TEXT.seat}`)
  const elevatorNodes = nodes.filter(n => n.kind === 'elevator')
  return {
    nodes,
    edges,
    legs,
    stairsCount: stairsEdges.reduce((sum, e) => sum + (e.stairs ?? 0), 0),
    stairsUnknown: stairsEdges.some(e => e.stairs === undefined),
    elevatorTrips: elevatorEdges.length,
    elevatorUnverified: elevatorNodes.some(n => !n.verified),
    meters: hasMeters && edges.length > 0 ? [edges.reduce((s, e) => s + e.meters![0], 0), edges.reduce((s, e) => s + e.meters![1], 0)] : null,
    steps: steps.map((text, i) => `${i + 1}. ${text}`),
  }
}

// 출발은 항상 입구. destLevel 층의 객석 지점이 도착이다.
export function findRoute(hall: IndoorHall, destLevel: number, mode: RouteMode): RouteResult {
  const entrance = hall.nodes.find(n => n.kind === 'entrance')
  const seat = hall.nodes.find(n => n.kind === 'seat' && n.level === destLevel)
  if (!entrance || !seat) return { status: 'no-data' }
  const attempt = (allowStairs: boolean) => shortestPath(buildAdjacency(hall.edges, allowStairs), entrance.id, seat.id)
  const first = attempt(mode === 'shortest')
  if (first) return { status: 'ok', route: describe(hall, first.ids, first.edges) }
  if (mode === 'nostairs') {
    const withStairs = attempt(true)
    if (withStairs) return { status: 'needs-stairs', alternative: describe(hall, withStairs.ids, withStairs.edges) }
  }
  return { status: 'blocked' }
}

// "약 40~70m(추정)"처럼 범위로만. 하나라도 거리를 모르면 "거리 정보 없음"
export function metersText(meters: [number, number] | null): string {
  if (!meters) return '거리 정보 없음'
  const [lo, hi] = meters.map(Math.round)
  return lo === hi ? `약 ${lo}m(추정)` : `약 ${lo}~${hi}m(추정)`
}

export type RouteChip = { text: string; tone: 'ok' | 'warn'; warnings: string[] }

// 정보 카드의 요약 칩: "계단 0개 · 엘리베이터 1회 · 약 60~90m(추정)". 계단 없이 갈 수 없거나 엘리베이터 위치가 확인 전이면 주황(warn)
export function routeChip(result: RouteResult): RouteChip | null {
  if (result.status === 'no-data' || result.status === 'blocked') return null
  const route = result.status === 'ok' ? result.route : result.alternative
  const stairs = route.stairsUnknown ? '계단 있음(칸 수 확인 전)' : `계단 ${route.stairsCount}개`
  const text = `${stairs} · 엘리베이터 ${route.elevatorTrips}회 · ${metersText(route.meters)}`
  const warnings: string[] = []
  if (result.status === 'needs-stairs') warnings.push('계단 없이는 갈 수 없어요')
  if (route.elevatorUnverified) warnings.push('엘리베이터 위치 확인 필요')
  return { text, tone: warnings.length > 0 ? 'warn' : 'ok', warnings }
}
