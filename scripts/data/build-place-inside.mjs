// 장소 안 지점·구간을 만든다: 설계 파일(data/places/inside/<id>.design.json) + OSM 보행로 추출.
// 결과: 시범 장소 파일(data/places/<id>.json)이 있으면 그 파일의 nodes/segments/courses를 바꾸고,
// 없으면 data/places/inside/<id>.json에 { placeId, nodes, segments, courses }를 쓴다.
// 같은 입력이면 항상 같은 결과가 나온다(시간·난수 없음). DB는 건드리지 않는다 (적재는 load-place-inside.mjs).
// 설계 파일에는 osmFile(OSM 추출본 경로), source(출처 문구), checkedAt(확인 날짜), course, 선택으로 boundaryWay(경계 way)를 적는다.
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

const SNAP_LIMIT_M = 40 // 지점을 그래프에 붙일 때 이보다 멀면 실패
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
    })
  }
}
if (baseEdges.length === 0) throw new Error('보행 간선이 없습니다.')

// 지점마다 가장 가까운 간선 위 점을 찾는다.
function nearestOnGraph(p) {
  let best = null
  for (let i = 0; i < baseEdges.length; i++) {
    const e = baseEdges[i]
    const t = projectOnSegment(p, e.A, e.B)
    const q = lerp(e.A, e.B, t)
    const d = haversine(p, q)
    if (!best || d < best.d - 1e-9) best = { edge: i, t, q, d }
  }
  return best
}

// 설계 지점 → 그래프 위 붙임 지점. 40m를 넘으면 실패하고 이유를 남긴다.
const designNodes = design.nodes.map(n => ({ ...n, coord: [n.lng, n.lat] }))
const snaps = {}
for (const node of designNodes) {
  const hit = nearestOnGraph(node.coord)
  if (hit.d > SNAP_LIMIT_M) throw new Error(`지점 ${node.id}가 보행로에서 ${hit.d.toFixed(1)}m 떨어져 붙이지 못했습니다.`)
  snaps[node.id] = hit
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
      wayId: e.wayId, steps: e.steps, stepCount: e.stepCount, incline: e.incline,
    })
  }
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

// ---- 경계 검사 ----
const boundaryPts = boundary ? boundary.geometry.map(p => [p.lon, p.lat]) : []
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
const segments = []
const report = { detours: [], accessSteps: [] }
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
  const tourExtra = isTour ? { courseId: COURSE_ID } : {}
  segments.push(makeSegment(seg, route, { ...tourExtra, source: SOURCE, checkedAt: CHECKED_AT, confidence: 'B' }))

  if (isTour && stairsOf(route.used).stairsStatus === 'present') {
    // 계단이 있는 관람 구간은 계단 없는 길로 우회하는 구간을 함께 둔다. 같은 순서, detourOf로 원 구간을 가리킨다.
    const detour = routeBetween(seg.from, seg.to, { avoidSteps: true })
    if (detour) {
      segments.push(makeSegment(seg, detour, {
        id: `${seg.id}d`, detourOf: seg.id, courseId: COURSE_ID, source: SOURCE, checkedAt: CHECKED_AT, confidence: 'B',
      }))
      report.detours.push(seg.id)
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
  source: SOURCE, checkedAt: CHECKED_AT, confidence: 'B',
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
  snapMeters: snapReport,
}, null, 2))
