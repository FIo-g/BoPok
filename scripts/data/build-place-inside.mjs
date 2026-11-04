// 장소 안 지점·구간을 만든다: 설계 파일(data/places/inside/<id>.design.json) + OSM 보행로 추출.
// 결과: 시범 장소 파일(data/places/<id>.json)이 있으면 그 파일의 nodes/segments/courses를 바꾸고,
// 없으면 data/places/inside/<id>.json에 { placeId, nodes, segments, courses }를 쓴다.
// 같은 입력이면 항상 같은 결과가 나온다(시간·난수 없음). DB는 건드리지 않는다 (적재는 load-place-inside.mjs).
// 설계 파일에는 osmFile(OSM 추출본 경로), source(출처 문구), checkedAt(확인 날짜), course, 선택으로 boundaryWay(경계 way)를 적는다.
// 설계 파일의 선택 칸: confidence(A/B/C, 기본 B, 지점별 confidence는 그 지점에 닿는 구간에 더 낮은 쪽으로 적용),
//   지점의 snapLimitM(100 이하)과 snapNote(보행로에서 먼 이유, 한 줄 필수), extraWays([{ id, note, coords }] 추출본에 선이 없는 길).
// 실행: node scripts/data/build-place-inside.mjs --id hanbat
//       node scripts/data/build-place-inside.mjs --id tourapi-12-125994  (설계 파일과 OSM 추출본이 있을 때)
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const { values } = parseArgs({ options: { id: { type: 'string' } } })
const id = values.id
if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('--id 장소 ID를 주세요. 예: --id hanbat')

const require = createRequire(import.meta.url)
const requireKit = createRequire(require.resolve('drizzle-kit'))
requireKit('tsx/cjs/api').register()
const { PlaceDetailSchema, PlaceNodeSchema, PlaceSegmentSchema, PlaceCourseSchema, PlaceIdInputSchema } = require('../../src/lib/contracts/place.ts')
const { z } = require('zod')
const PlaceInsideFileSchema = z.object({
  placeId: PlaceIdInputSchema,
  nodes: PlaceNodeSchema.array(),
  segments: PlaceSegmentSchema.array(),
  courses: PlaceCourseSchema.array(),
})

const SNAP_LIMIT_M = 40 // 지점을 그래프에 붙일 때 이보다 멀면 실패 (설계의 snapLimitM이 없을 때)
const SNAP_LIMIT_MAX_M = 100 // 설계가 정할 수 있는 붙임 한도의 상한
const EXTRA_END_LIMIT_M = 10 // extraWays의 양 끝은 보행망 위의 점에서 이 거리 안이어야 한다
const BOUNDARY_LIMIT_M = 30 // 관람 지점은 경계 안이거나 이 거리 안이어야 한다 (설계에 boundaryWay가 있을 때만)
const WALK_HIGHWAYS = new Set(['footway', 'path', 'pedestrian', 'steps', 'service', 'living_street', 'track'])

const designPath = join(root, `data/places/inside/${id}.design.json`)
if (!existsSync(designPath)) throw new Error(`설계 파일이 없습니다: data/places/inside/${id}.design.json`)
const design = JSON.parse(await readFile(designPath, 'utf8'))

// OSM 추출본: 설계 파일의 osmFile, 없으면 data/places/osm/<id>-osm-*.json 하나.
async function findOsmPath() {
  if (design.osmFile) return join(root, design.osmFile)
  const dir = join(root, 'data/places/osm')
  const names = (await readdir(dir)).filter(name => name.startsWith(`${id}-osm-`) && name.endsWith('.json'))
  if (names.length !== 1) throw new Error(`OSM 추출본을 하나로 정하지 못했습니다(${names.length}개). 설계 파일에 osmFile을 적어 주세요.`)
  return join(dir, names[0])
}
const osmPath = await findOsmPath()
const osm = JSON.parse(await readFile(osmPath, 'utf8'))

// 출처·확인 날짜는 설계 파일에서 읽는다. 없으면 결과에 근거를 남길 수 없어 멈춘다 (AGENTS 6장).
if (!design.source || !design.checkedAt) throw new Error('설계 파일에 source(출처)와 checkedAt(확인 날짜)를 적어 주세요.')
const SOURCE = design.source
const CHECKED_AT = design.checkedAt
const COURSE_ID = design.course?.id
const BOUNDARY_WAY = design.boundaryWay
// 신뢰 등급: 설계 전체 등급(기본 B)과 지점별 등급 중 낮은 쪽을 구간에 쓴다. 안내도 맞춤 지점은 설계에서 C로 적는다.
const CONFIDENCE_RANK = { A: 0, B: 1, C: 2 }
const DESIGN_CONFIDENCE = design.confidence ?? 'B'
const nodeConfidence = new Map(design.nodes.map(n => [n.id, n.confidence ?? 'B']))
for (const level of [DESIGN_CONFIDENCE, ...nodeConfidence.values()]) {
  if (!['A', 'B', 'C'].includes(level)) throw new Error(`confidence는 A, B, C 중 하나여야 합니다: ${level}`)
}

// 시범 장소 파일이 있으면 그 파일에 쓰고, 없으면 장소 안 전용 파일을 만든다.
const placePath = join(root, `data/places/${id}.json`)
const insidePath = join(root, `data/places/inside/${id}.json`)
const hasPilotFile = existsSync(placePath)
const base = hasPilotFile ? JSON.parse(await readFile(placePath, 'utf8')) : null
if (base && base.id !== id) throw new Error(`data/places/${id}.json의 id가 ${base.id}입니다.`)
const placeId = id

// ---- 기하 ----
const R = 6371000
const rad = d => (d * Math.PI) / 180
function haversine([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
const keyOf = ([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)}`

// 점에서 선분에 내린 수선의 발. 짧은 거리라 위경도를 평면으로 보고 t(0~1)를 구한다.
function projectOnSegment(p, a, b) {
  const k = Math.cos(rad((a[1] + b[1]) / 2))
  const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.min(1, Math.max(0, t))
  return t
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

// ---- OSM 보행 그래프 ----
// 한 way의 연속된 두 점을 간선 하나로 본다. 간선에는 그 way의 태그(계단·경사)를 붙인다.
const ways = osm.elements.filter(e => e.type === 'way' && e.geometry && e.tags?.highway && (
  WALK_HIGHWAYS.has(e.tags.highway) || (e.tags.highway === 'cycleway' && ['yes', 'designated'].includes(e.tags.foot))
))
// 경계 way가 없는 장소는 경계 검사를 건너뛴다(설계가 정하지 않은 장소의 지점을 임의로 막지 않는다).
const boundary = BOUNDARY_WAY === undefined ? null : osm.elements.find(e => e.type === 'way' && e.id === BOUNDARY_WAY)
if (BOUNDARY_WAY !== undefined && !boundary) throw new Error('OSM 추출에 설계의 경계 way가 없습니다.')

const baseEdges = []
for (const way of ways) {
  const pts = way.geometry
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]
    if (keyOf(a) === keyOf(b)) continue
    baseEdges.push({
      a: keyOf(a), b: keyOf(b), A: a, B: b, wayId: way.id,
      steps: way.tags.highway === 'steps',
      stepCount: way.tags.step_count === undefined ? undefined : Number(way.tags.step_count),
      incline: way.tags.incline !== undefined && !['no', '0'].includes(way.tags.incline),
      // 출입이 막힌 길(access=no·private)은 원천 지도에 있을 때만 알 수 있다. 경로에 쓰이면 보고서에 적는다.
      restricted: ['no', 'private'].includes(way.tags.access),
    })
  }
}
if (baseEdges.length === 0) throw new Error('보행 간선이 없습니다.')

// 지점마다 가장 가까운 간선 위 점을 찾는다. extraWays는 붙임 대상이 아니므로 OSM 간선만 본다.
const osmEdgeCount = baseEdges.length
function nearestOnGraph(p) {
  let best = null
  for (let i = 0; i < osmEdgeCount; i++) {
    const e = baseEdges[i]
    const t = projectOnSegment(p, e.A, e.B)
    const q = lerp(e.A, e.B, t)
    const d = haversine(p, q)
    if (!best || d < best.d - 1e-9) best = { edge: i, t, q, d }
  }
  return best
}

// 설계 지점 → 그래프 위 붙임 지점. 한도(기본 40m)를 넘으면 실패한다. 한도를 바꾸려면 설계에 snapLimitM과 snapNote를 함께 적는다.
function snapLimitOf(node) {
  if (node.snapLimitM === undefined) return SNAP_LIMIT_M
  if (!(node.snapLimitM > 0 && node.snapLimitM <= SNAP_LIMIT_MAX_M)) throw new Error(`지점 ${node.id}의 snapLimitM은 0보다 크고 ${SNAP_LIMIT_MAX_M} 이하여야 합니다.`)
  if (!node.snapNote) throw new Error(`지점 ${node.id}에 snapLimitM을 주려면 snapNote(보행로에서 먼 이유)를 적어 주세요.`)
  return node.snapLimitM
}
const designNodes = design.nodes.map(n => ({ ...n, coord: [n.lng, n.lat] }))
const snaps = {}
for (const node of designNodes) {
  const limit = snapLimitOf(node)
  const hit = nearestOnGraph(node.coord)
  if (hit.d > limit) throw new Error(`지점 ${node.id}가 보행로에서 ${hit.d.toFixed(1)}m 떨어져 붙이지 못했습니다(한도 ${limit}m).`)
  snaps[node.id] = hit
}

// 설계의 extraWays 양 끝도 보행망 위에 붙인다. 가운데 점은 그대로 쓰는 선이다.
const extraWays = (design.extraWays ?? []).map(w => {
  if (!w.id || !w.note) throw new Error(`extraWay ${w.id ?? '(id 없음)'}에 id와 note(어떤 지형지물에서 좌표를 땄는지)가 필요합니다.`)
  if (!Array.isArray(w.coords) || w.coords.length < 2 || !w.coords.every(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))) {
    throw new Error(`extraWay ${w.id}의 coords는 [lng,lat] 점 두 개 이상이어야 합니다.`)
  }
  return w
})
if (new Set(extraWays.map(w => w.id)).size !== extraWays.length) throw new Error('extraWays의 id가 겹칩니다.')
const extraReport = []
for (const w of extraWays) {
  for (const [end, coord] of [['start', w.coords[0]], ['end', w.coords[w.coords.length - 1]]]) {
    const hit = nearestOnGraph(coord)
    if (hit.d > EXTRA_END_LIMIT_M) throw new Error(`extraWay ${w.id}의 ${end} 점이 보행망에서 ${hit.d.toFixed(1)}m 떨어져 있습니다(한도 ${EXTRA_END_LIMIT_M}m).`)
    snaps[`x:${w.id}:${end}`] = hit
  }
}

// 붙임 지점이 간선 끝(교차점)에 거의 닿으면 그 교차점을 쓰고, 아니면 간선을 나눠 새 점을 넣는다.
const VERTEX_EPS = 1e-9
const splitsByEdge = new Map()
for (const [nodeId, hit] of Object.entries(snaps)) {
  const e = baseEdges[hit.edge]
  if (hit.t <= VERTEX_EPS) snaps[nodeId] = { ...hit, key: e.a, q: e.A }
  else if (hit.t >= 1 - VERTEX_EPS) snaps[nodeId] = { ...hit, key: e.b, q: e.B }
  else {
    const list = splitsByEdge.get(hit.edge) ?? []
    list.push({ nodeId, t: hit.t, q: hit.q })
    splitsByEdge.set(hit.edge, list)
  }
}
for (const list of splitsByEdge.values()) list.sort((x, y) => x.t - y.t || (x.nodeId < y.nodeId ? -1 : 1))

// 간선을 나눈 뒤의 그래프. 간선 하나 = 직선 한 조각.
const edges = []
for (let i = 0; i < baseEdges.length; i++) {
  const e = baseEdges[i]
  const splits = splitsByEdge.get(i) ?? []
  const chain = [{ key: e.a, pt: e.A }]
  for (const s of splits) {
    const key = `snap:${s.nodeId}`
    snaps[s.nodeId] = { ...snaps[s.nodeId], key, q: s.q }
    chain.push({ key, pt: s.q })
  }
  chain.push({ key: e.b, pt: e.B })
  for (let j = 0; j + 1 < chain.length; j++) {
    if (chain[j].key === chain[j + 1].key) continue
    edges.push({
      from: chain[j].key, to: chain[j + 1].key, pts: [chain[j].pt, chain[j + 1].pt],
      wayId: e.wayId, steps: e.steps, stepCount: e.stepCount, incline: e.incline, restricted: e.restricted,
    })
  }
}
// extraWays 간선: 양 끝은 붙임 지점, 가운데 점은 그대로. 계단·경사 정보가 없으므로 unknown(경사 없음으로 둔다).
for (const w of extraWays) {
  const s = snaps[`x:${w.id}:start`], t = snaps[`x:${w.id}:end`]
  const chain = [{ key: s.key, pt: s.q }]
  for (const c of w.coords.slice(1, -1)) chain.push({ key: keyOf(c), pt: c })
  chain.push({ key: t.key, pt: t.q })
  let lengthM = 0
  for (let j = 0; j + 1 < chain.length; j++) {
    if (chain[j].key === chain[j + 1].key) continue
    edges.push({
      from: chain[j].key, to: chain[j + 1].key, pts: [chain[j].pt, chain[j + 1].pt],
      wayId: `extra:${w.id}`, steps: false, stepCount: undefined, incline: false, restricted: false,
    })
    lengthM += haversine(chain[j].pt, chain[j + 1].pt)
  }
  extraReport.push({ id: w.id, note: w.note, lengthM: Math.round(lengthM) })
}

const adjacency = new Map()
edges.forEach((edge, index) => {
  for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from).push({ to, index, w: haversine(edge.pts[0], edge.pts[1]) })
  }
})

// 최소 힙. 원소는 [거리, 키]이고 거리가 같으면 키 문자열 순서로 나온다.
class MinHeap {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) }
  push(d, key) {
    this.items.push([d, key])
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(this.items[i], this.items[parent])) break
      ;[this.items[i], this.items[parent]] = [this.items[parent], this.items[i]]
      i = parent
    }
  }
  pop() {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < this.items.length && this.less(this.items[l], this.items[m])) m = l
        if (r < this.items.length && this.less(this.items[r], this.items[m])) m = r
        if (m === i) break
        ;[this.items[i], this.items[m]] = [this.items[m], this.items[i]]
        i = m
      }
    }
    return top
  }
}

// 다익스트라. 같은 거리면 키 순서로 골라 결과가 항상 같게 한다.
function shortestEdges(startKey, endKey, { avoidSteps }) {
  const dist = new Map([[startKey, 0]])
  const prev = new Map()
  const done = new Set()
  const heap = new MinHeap()
  heap.push(0, startKey)
  while (heap.size) {
    const [d, key] = heap.pop()
    if (done.has(key)) continue
    done.add(key)
    if (key === endKey) break
    for (const next of adjacency.get(key) ?? []) {
      if (avoidSteps && edges[next.index].steps) continue
      const nd = d + next.w
      if (nd < (dist.get(next.to) ?? Infinity)) {
        dist.set(next.to, nd)
        prev.set(next.to, { from: key, index: next.index })
        heap.push(nd, next.to)
      }
    }
  }
  if (!dist.has(endKey)) return null
  const used = []
  let cur = endKey
  while (cur !== startKey) {
    const step = prev.get(cur)
    used.push({ index: step.index, forward: edges[step.index].from === step.from })
    cur = step.from
  }
  return used.reverse()
}

// 간선 목록을 좌표열로. 양 끝 설계 지점을 붙이고, 같은 점이 연속되면 하나로 합친다.
function buildPath(startNode, endNode, used) {
  const coords = [startNode.coord]
  for (const { index, forward } of used) {
    const pts = edges[index].pts
    for (const pt of forward ? pts : [...pts].reverse()) {
      if (keyOf(pt) !== keyOf(coords[coords.length - 1])) coords.push(pt)
    }
  }
  if (keyOf(endNode.coord) !== keyOf(coords[coords.length - 1])) coords.push(endNode.coord)
  return coords
}
const pathLength = coords => coords.slice(1).reduce((sum, p, i) => sum + haversine(coords[i], p), 0)

function routeBetween(fromId, toId, options = {}) {
  const from = designNodes.find(n => n.id === fromId)
  const to = designNodes.find(n => n.id === toId)
  if (!from || !to) throw new Error(`구간의 지점을 찾을 수 없습니다: ${fromId} → ${toId}`)
  const used = shortestEdges(snaps[fromId].key, snaps[toId].key, options)
  if (!used) return null
  const path = buildPath(from, to, used)
  // 같은 지점끼리 이어지는 구간은 0m가 될 수 있으므로 최소 두 점을 남긴다.
  if (path.length < 2) throw new Error(`구간 ${fromId} → ${toId}의 경로가 비었습니다.`)
  return { used, path, from, to }
}

// 계단 정보는 이 구간 경로에 쓰인 간선에서만 읽는다. 같은 계단 way는 한 번만 센다.
function stairsOf(used) {
  const stepWays = new Map()
  for (const { index } of used) {
    const edge = edges[index]
    if (edge.steps) stepWays.set(edge.wayId, edge.stepCount)
  }
  if (stepWays.size === 0) return { stairsStatus: 'unknown' }
  const counts = [...stepWays.values()]
  const stairsCount = counts.every(count => count !== undefined) ? counts.reduce((sum, count) => sum + count, 0) : undefined
  return { stairsStatus: 'present', stairsCount }
}

const slopeOf = used => used.some(({ index }) => edges[index].incline)
// 경로에 쓰인 출입 제한 길의 way 번호(중복 없이). 빈 배열이면 제한 길을 지나지 않는다.
const restrictedWaysOf = used => [...new Set(used.filter(({ index }) => edges[index].restricted).map(({ index }) => edges[index].wayId))]

// ---- 경계 검사 ----
// 추출본 way의 geometry는 [lng,lat] 배열이고, 예전 추출본은 {lon,lat} 객체였다. 두 모양을 모두 읽는다.
const boundaryPts = boundary ? boundary.geometry.map(p => (Array.isArray(p) ? [p[0], p[1]] : [p.lon, p.lat])) : []
function insidePolygon([x, y]) {
  let inside = false
  for (let i = 0, j = boundaryPts.length - 1; i < boundaryPts.length; j = i++) {
    const [xi, yi] = boundaryPts[i], [xj, yj] = boundaryPts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function distanceToBoundary(p) {
  if (boundaryPts.length < 2) return 0
  let best = Infinity
  for (let i = 0; i + 1 < boundaryPts.length; i++) {
    const a = boundaryPts[i], b = boundaryPts[i + 1]
    best = Math.min(best, haversine(p, lerp(a, b, projectOnSegment(p, a, b))))
  }
  return best
}

// ---- 지점 만들기 ----
const nodes = designNodes.map(n => {
  if (boundary && !['parking', 'stop'].includes(n.kind)) {
    const d = insidePolygon(n.coord) ? 0 : distanceToBoundary(n.coord)
    if (d > BOUNDARY_LIMIT_M) throw new Error(`지점 ${n.id}가 장소 경계에서 ${d.toFixed(1)}m 떨어져 있습니다.`)
  }
  const node = {
    id: n.id, placeId, kind: n.kind, name: n.name,
    restType: n.restType === 'none' ? null : n.restType,
    coord: n.coord,
  }
  if (n.guideNo !== undefined) node.guideNo = n.guideNo
  if (n.floor !== undefined) node.floor = n.floor
  return node
})

// ---- 구간 만들기 ----
const segmentConfidence = seg => [DESIGN_CONFIDENCE, nodeConfidence.get(seg.from), nodeConfidence.get(seg.to)]
  .filter(level => level !== undefined)
  .reduce((worst, level) => (CONFIDENCE_RANK[level] > CONFIDENCE_RANK[worst] ? level : worst))
const segments = []
const report = { detours: [], accessSteps: [], restricted: [] }
// 구간 한 줄. 계단·경사는 그 경로에서 읽은 값만 쓴다.
function makeSegment(seg, route, extra) {
  const stairs = stairsOf(route.used)
  return {
    id: seg.id, placeId, fromNodeId: seg.from, toNodeId: seg.to, order: seg.order,
    distanceM: Math.round(pathLength(route.path)), path: route.path.map(p => [p[0], p[1]]),
    stairsStatus: stairs.stairsStatus,
    ...(stairs.stairsCount === undefined ? {} : { stairsCount: stairs.stairsCount }),
    slope: slopeOf(route.used), optional: seg.optional,
    ...extra,
  }
}
const sorted = [...design.segments].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
for (const seg of sorted) {
  const isTour = seg.role === 'tour'
  let route = routeBetween(seg.from, seg.to)
  if (!route) throw new Error(`구간 ${seg.id}의 OSM 보행 경로가 없습니다.`)
  if (!isTour && stairsOf(route.used).stairsStatus === 'present') {
    // 입구 접근은 설계대로 계단 없는 길이 있으면 그 길을 쓴다.
    const stepFree = routeBetween(seg.from, seg.to, { avoidSteps: true })
    if (stepFree) {
      route = stepFree
      report.accessSteps.push(seg.id)
    }
  }
  if (isTour && !COURSE_ID) throw new Error('관람 구간이 있으면 설계 파일에 course.id가 필요합니다.')
  if (restrictedWaysOf(route.used).length) report.restricted.push({ id: seg.id, ways: restrictedWaysOf(route.used) })
  const tourExtra = isTour ? { courseId: COURSE_ID } : {}
  segments.push(makeSegment(seg, route, { ...tourExtra, source: SOURCE, checkedAt: CHECKED_AT, confidence: segmentConfidence(seg) }))

  if (isTour && stairsOf(route.used).stairsStatus === 'present') {
    // 계단이 있는 관람 구간은 계단 없는 길로 우회하는 구간을 함께 둔다. 같은 순서, detourOf로 원 구간을 가리킨다.
    const detour = routeBetween(seg.from, seg.to, { avoidSteps: true })
    if (detour) {
      segments.push(makeSegment(seg, detour, {
        id: `${seg.id}d`, detourOf: seg.id, courseId: COURSE_ID, source: SOURCE, checkedAt: CHECKED_AT, confidence: segmentConfidence(seg),
      }))
      report.detours.push(seg.id)
      if (restrictedWaysOf(detour.used).length) report.restricted.push({ id: `${seg.id}d`, ways: restrictedWaysOf(detour.used) })
    }
  }
}
// 우회 구간의 path 시작·끝도 그 구간의 설계 지점이어야 하므로 경로 끝점을 확인한다.
for (const s of segments) {
  const from = nodes.find(n => n.id === s.fromNodeId)
  const to = nodes.find(n => n.id === s.toNodeId)
  if (keyOf(s.path[0]) !== keyOf(from.coord) || keyOf(s.path[s.path.length - 1]) !== keyOf(to.coord)) {
    throw new Error(`구간 ${s.id}의 경로 끝점이 지점과 다릅니다.`)
  }
}

const courses = design.course ? [{
  id: COURSE_ID, name: design.course.name, recommended: true,
  source: SOURCE, checkedAt: CHECKED_AT, confidence: DESIGN_CONFIDENCE,
}] : []

// 시범 장소 파일은 기존 장소 칸을 그대로 두고 지점·구간·코스만 바꾼다. 전용 파일은 장소 안 칸만 쓴다.
let outPath
let out
if (base) {
  const placeRow = { ...base }
  delete placeRow.nodes
  delete placeRow.segments
  out = { ...placeRow, nodes, segments, courses }
  const parsed = PlaceDetailSchema.safeParse(out)
  if (!parsed.success) {
    console.error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2))
    throw new Error('장소 계약 검사에 실패해 파일을 쓰지 않았습니다.')
  }
  outPath = placePath
} else {
  out = { placeId, nodes, segments, courses }
  const parsed = PlaceInsideFileSchema.safeParse(out)
  if (!parsed.success) {
    console.error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2))
    throw new Error('장소 안 계약 검사에 실패해 파일을 쓰지 않았습니다.')
  }
  outPath = insidePath
}
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n')

const tourSegments = segments.filter(s => s.courseId && s.detourOf === undefined)
const tourMain = tourSegments.filter(s => !s.optional)
const snapReport = Object.fromEntries(designNodes.map(n => [n.id, Math.round(snaps[n.id].d * 10) / 10]))
const countBy = (list, key) => list.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] ?? 0) + 1 }), {})
console.log(JSON.stringify({
  file: relative(root, outPath),
  nodes: nodes.length,
  segments: segments.length,
  detourSegments: segments.filter(s => s.detourOf !== undefined).length,
  courses: courses.length,
  guideNumbers: nodes.filter(n => n.guideNo !== undefined).map(n => ({ id: n.id, guideNo: n.guideNo })),
  floors: nodes.filter(n => n.floor !== undefined).map(n => ({ id: n.id, floor: n.floor })),
  tourMeters: tourMain.reduce((sum, s) => sum + s.distanceM, 0),
  tourMetersWithOptional: tourSegments.reduce((sum, s) => sum + s.distanceM, 0),
  stairsPresentSegments: segments.filter(s => s.stairsStatus === 'present').map(s => s.id),
  accessStepsAvoided: report.accessSteps,
  detoursOf: report.detours,
  // 출입 제한(access=no·private) 길을 지나는 구간. 원천 지도 태그가 추출본에 남아 있어야 보인다. 그 구간은 신뢰 등급을 C로 낮추고 설계 notes에 적는다.
  restrictedSegments: report.restricted,
  snapMeters: snapReport,
  snapMaxM: Math.max(...designNodes.map(n => Math.round(snaps[n.id].d * 10) / 10)),
  snapLimitChanged: designNodes.filter(n => n.snapLimitM !== undefined).map(n => ({ id: n.id, snapLimitM: n.snapLimitM, snapNote: n.snapNote, snapMeters: snapReport[n.id] })),
  extraWays: extraReport,
  confidence: countBy(segments, 'confidence'),
}, null, 2))
