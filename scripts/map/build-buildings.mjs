// 대전 GIS건물통합정보(SHP) → 3D 건물·그림자용 벡터 타일(public/tiles/buildings/{z}/{x}/{y}.pbf, 레이어 buildings·shadows)
// 실행: pnpm data:buildings   (원본은 data/raw/daejeon-buildings/ 에 둔다)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import mapshaper from 'mapshaper'
import geojsonvt from 'geojson-vt'
import vtpbf from 'vt-pbf'
import { shadowRing } from './lib/geometry.mjs'
import { SHADOW_BEARING_DEG, SHADOW_LENGTH_RATIO, TREE_BBOX } from '../../src/components/map/map-config.ts'

// ───────── 조절 값 ─────────
// WGS84 [경도min, 위도min, 경도max, 위도max]. null 이면 대전 전체. 범위를 주면 중심점이 안에 있는 건물만 통째로 남긴다
const BBOX = null
const TILE_MIN_ZOOM = 14           // 이 줌부터 타일을 만든다(건물 레이어 minzoom 과 같게)
const TILE_MAX_ZOOM = 16           // 이보다 크게 확대하면 지도가 이 타일을 늘려서 쓴다
const TILE_EXTENT = 4096
const MIN_AREA_M2 = 15          // 이보다 작은 건물(창고·부속 구조물)은 제외
const DEFAULT_H = 6             // 높이·층수 둘 다 없을 때 (약 2층)
const RATIO_MIN = 2             // height ÷ floors 가 이 값(m) 미만이면 이상값
const RATIO_MAX = 8             // height ÷ floors 가 이 값(m) 초과면 이상값
const LOW_FLOORS_MAX = 4        // 1~4층 = 저층, 5층 이상 = 고층
const MAX_FLOORS = 100          // 이 값 초과는 이상값(null)
const WARN_BYTES = 10 * 1024 * 1024
const NAME = 'AL_D010_30_20261009'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW = path.join(root, 'data/raw/daejeon-buildings', NAME)
const OUT_DIR = path.join(root, 'public/tiles/buildings')

// ───────── 좌표 변환: WGS84 → EPSG:5186 (GRS80 횡메르카토르) ─────────
const PROJ5186 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
const A = 6378137.0, F = 1 / 298.257222101, E2 = 2 * F - F * F, EP2 = E2 / (1 - E2)
const meridian = phi => A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
  - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
  + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
  - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi))
function toTM(lon, lat) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180, lam0 = 127 * Math.PI / 180, phi0 = 38 * Math.PI / 180
  const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = EP2 * Math.cos(phi) ** 2
  const a = (lam - lam0) * Math.cos(phi)
  const x = 200000 + N * (a + (1 - T + C) * a ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5 / 120)
  const y = 600000 + meridian(phi) - meridian(phi0) + N * Math.tan(phi) * (a * a / 2 + (5 - T + 9 * C + 4 * C * C) * a ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6 / 720)
  return [x, y]
}
// 권역(WGS84 사각형)을 원본 좌표계로 옮긴 사각형. 중심점이 이 안에 있으면 건물을 통째로 남긴다.
const QUAD = BBOX ? [[BBOX[0], BBOX[1]], [BBOX[2], BBOX[1]], [BBOX[2], BBOX[3]], [BBOX[0], BBOX[3]]].map(([lo, la]) => toTM(lo, la)) : null
const QX = QUAD ? [Math.min(...QUAD.map(p => p[0])), Math.max(...QUAD.map(p => p[0]))] : [-Infinity, Infinity]
const QY = QUAD ? [Math.min(...QUAD.map(p => p[1])), Math.max(...QUAD.map(p => p[1]))] : [-Infinity, Infinity]
function inQuad(x, y) {
  if (!QUAD) return true
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = QUAD[i], [x2, y2] = QUAD[(i + 1) % 4]
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
    if (cross !== 0) { if (sign && Math.sign(cross) !== sign) return false; sign = Math.sign(cross) }
  }
  return true
}

// ───────── 원본 읽기 ─────────
for (const ext of ['shp', 'shx', 'dbf', 'prj']) {
  if (!fs.existsSync(`${RAW}.${ext}`)) throw new Error(`원본 누락: ${RAW}.${ext}`)
}
if (!fs.readFileSync(`${RAW}.prj`, 'utf8').includes('5186')) throw new Error('.prj 가 EPSG:5186 이 아니에요. 좌표 변환을 확인하세요.')
const shp = fs.readFileSync(`${RAW}.shp`)
const dbf = fs.readFileSync(`${RAW}.dbf`)
const nrec = dbf.readUInt32LE(4), hlen = dbf.readUInt16LE(8), rlen = dbf.readUInt16LE(10)
const fieldPos = {}
{
  let o = 1
  for (let p = 32; dbf[p] !== 0x0d; p += 32) {
    const name = dbf.toString('ascii', p, p + 11).replace(/\0.*$/, '')
    const len = dbf[p + 16]
    fieldPos[name] = [o, len]
    o += len
  }
}
const cp949 = new TextDecoder('euc-kr')
const rawField = (i, name) => {
  const [o, len] = fieldPos[name]
  const s = hlen + i * rlen + o
  return dbf.subarray(s, s + len)
}
// NUL 패딩·앞뒤 공백 제거
const text = (i, name) => cp949.decode(rawField(i, name)).replace(/\0/g, '').trim()
// ****** 등 숫자가 아닌 값, 0 은 null
const posNum = (i, name) => {
  const s = text(i, name)
  if (!s || s.includes('*')) return null
  const v = Number(s)
  return Number.isFinite(v) && v > 0 ? v : null
}
const floorsOf = i => {
  const v = posNum(i, 'A26')
  return v !== null && v <= MAX_FLOORS ? Math.round(v) : null
}

// 1) 도형: 레코드 위치를 훑으며 후보(권역 근처)만 골라 중심점·면적을 구한다
const ringArea = r => { let s = 0; for (let k = 0, n = r.length - 1; k < n; k++) s += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]; return s / 2 }
function readPolygon(pos) {
  const body = pos + 8
  const numParts = shp.readInt32LE(body + 36), numPoints = shp.readInt32LE(body + 40)
  const partsAt = body + 44, ptsAt = partsAt + 4 * numParts
  const starts = Array.from({ length: numParts }, (_, k) => shp.readInt32LE(partsAt + 4 * k)).concat(numPoints)
  const rings = []
  for (let k = 0; k < numParts; k++) {
    const ring = []
    for (let j = starts[k]; j < starts[k + 1]; j++) ring.push([shp.readDoubleLE(ptsAt + 16 * j), shp.readDoubleLE(ptsAt + 16 * j + 8)])
    rings.push(ring)
  }
  return rings
}
const MARGIN = 300 // 후보를 넉넉히 잡는 여유(m). 정확한 판정은 중심점으로 다시 한다
let total = 0, nearCount = 0, inAreaCount = 0, tooSmall = 0
const kept = []
for (let pos = 100, i = 0; pos < shp.length; i++) {
  const len = shp.readInt32BE(pos + 4) * 2
  const type = shp.readInt32LE(pos + 8)
  if (type === 5) {
    const bx0 = shp.readDoubleLE(pos + 12), by0 = shp.readDoubleLE(pos + 20), bx1 = shp.readDoubleLE(pos + 28), by1 = shp.readDoubleLE(pos + 36)
    if (bx1 >= QX[0] - MARGIN && bx0 <= QX[1] + MARGIN && by1 >= QY[0] - MARGIN && by0 <= QY[1] + MARGIN) {
      nearCount++
      const rings = readPolygon(pos)
      let area = 0, cx = 0, cy = 0
      for (const r of rings) {
        const a = ringArea(r) // 시계 방향(음수) = 바깥 고리, 반시계 = 구멍
        area += -a
        for (let k = 0, n = r.length - 1; k < n; k++) {
          const cr = r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1]
          cx += (r[k][0] + r[k + 1][0]) * cr; cy += (r[k][1] + r[k + 1][1]) * cr
        }
      }
      // 중심점(면적 가중). 퇴화 도형이면 bbox 중심으로 대신한다
      const sum = rings.reduce((s, r) => s + ringArea(r), 0)
      const mx = Math.abs(sum) > 1e-9 ? cx / (6 * sum) : (bx0 + bx1) / 2
      const my = Math.abs(sum) > 1e-9 ? cy / (6 * sum) : (by0 + by1) / 2
      if (inQuad(mx, my)) {
        inAreaCount++
        if (area < MIN_AREA_M2) tooSmall++
        else kept.push({ i, rings, area })
      }
    }
  }
  pos += 8 + len
  total++
}
if (total !== nrec) throw new Error(`shp(${total})와 dbf(${nrec}) 레코드 수가 달라요`)

// 2) 층고: 도시 전체에서 height·floors 가 둘 다 정상인 건물로 저층/고층 중앙값을 구한다
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const lowRatios = [], highRatios = []
for (let i = 0; i < nrec; i++) {
  const f = floorsOf(i), h = posNum(i, 'A16')
  if (f === null || h === null) continue
  const r = h / f
  if (r < RATIO_MIN || r > RATIO_MAX) continue
  ;(f <= LOW_FLOORS_MAX ? lowRatios : highRatios).push(r)
}
const lowH = median(lowRatios), highH = median(highRatios)
if (lowH === null || highH === null) throw new Error('층고 중앙값을 구할 수 없어요')
const round1 = v => Math.round(v * 10) / 10

// 3) 속성 정리 + 높이(h) 결정
const srcCount = {}
const feats = kept.map(k => {
  const srcId = text(k.i, 'A1')
  const floors = floorsOf(k.i)
  const height = posNum(k.i, 'A16')
  const ratio = height !== null && floors !== null ? height / floors : null
  let h, hSource
  if (height !== null && (ratio === null || (ratio >= RATIO_MIN && ratio <= RATIO_MAX))) { h = height; hSource = 'height' }
  else if (floors !== null) { h = floors * (floors <= LOW_FLOORS_MAX ? lowH : highH); hSource = 'floors' }
  else { h = DEFAULT_H; hSource = 'default' }
  srcCount[hSource] = (srcCount[hSource] ?? 0) + 1
  return { i: k.i, rings: k.rings, props: { srcId, floors, height: height === null ? null : round1(height), h: round1(h), hSource } }
})
// fid: 원본 id(srcId) 정렬 기준으로 1부터. 같은 id 는 원본 순서로 고정
feats.sort((a, b) => (a.props.srcId < b.props.srcId ? -1 : a.props.srcId > b.props.srcId ? 1 : a.i - b.i))
feats.forEach((f, n) => { f.props = { fid: n + 1, ...f.props } })

// 4) GeoJSON(원본 좌표계) → mapshaper 로 WGS84 변환·소수 6자리
const geo = {
  type: 'FeatureCollection',
  features: feats.map(f => {
    const outers = [], holes = []
    for (const r of f.rings) (ringArea(r) < 0 ? outers : holes).push(r)
    if (!outers.length) outers.push(...holes.splice(0))
    const polys = outers.map(o => [o])
    for (const hole of holes) { const t = polys.find(p => pointInRing(hole[0], p[0])) ?? polys[0]; t.push(hole) }
    return { type: 'Feature', properties: f.props, geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys } }
  }),
}
function pointInRing([x, y], ring) {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b]
    if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside
  }
  return inside
}
// 4-2) 그림자: 건물 바닥을 해 반대편(북동쪽)으로 h × 비율 만큼 옮긴 것과 합쳐 볼록 껍질로 감싼다. 미터 단위인 원본 좌표계에서 계산한다
const shadowGeo = {
  type: 'FeatureCollection',
  features: feats.map(f => {
    const outers = f.rings.filter(r => ringArea(r) < 0)
    const ring = shadowRing(outers.length ? outers : f.rings, f.props.h, SHADOW_BEARING_DEG, SHADOW_LENGTH_RATIO)
    return { type: 'Feature', properties: { fid: f.props.fid }, geometry: { type: 'Polygon', coordinates: [ring] } }
  }),
}
const shadowOut = await mapshaper.applyCommands(
  `-i in.json -proj wgs84 from="${PROJ5186}" -o out.json format=geojson rfc7946 precision=0.000001`,
  { 'in.json': JSON.stringify(shadowGeo) },
)
const shadows = JSON.parse(Buffer.from(shadowOut['out.json']).toString('utf8'))
const out = await mapshaper.applyCommands(
  `-i in.json -proj wgs84 from="${PROJ5186}" -o out.json format=geojson rfc7946 precision=0.000001`,
  { 'in.json': JSON.stringify(geo) },
)
const parsed = JSON.parse(Buffer.from(out['out.json']).toString('utf8'))
const n = parsed.features.length

// 나무 스크립트가 건물 위에 나무를 놓지 않도록, 시연 권역(TREE_BBOX) 건물의 바깥 고리를 data/raw/derived 에 저장한다
{
  const [w, s, e, nn] = TREE_BBOX
  const rings = []
  for (const f of parsed.features) {
    const parts = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const part of parts) {
      const ring = part[0]
      if (ring.some(([x, y]) => x >= w && x <= e && y >= s && y <= nn)) rings.push(ring)
    }
  }
  const dir = path.join(root, 'data/raw/derived')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'buildings-footprints.json'), JSON.stringify(rings))
}

// 5) 벡터 타일. 타일에는 지도가 읽는 속성(fid, h, floors, d)만 싣는다. d=1 은 높이 정보가 없어 기본 높이로 정한 건물
for (const f of parsed.features) f.properties = { fid: f.properties.fid, h: f.properties.h, floors: f.properties.floors, ...(f.properties.hSource === 'default' ? { d: 1 } : {}) }
const tileOptions = { minZoom: 0, maxZoom: TILE_MAX_ZOOM, indexMaxZoom: TILE_MAX_ZOOM, indexMaxPoints: 0, extent: TILE_EXTENT, buffer: 64, tolerance: 3 }
const index = new geojsonvt(parsed, tileOptions)
const shadowIndex = new geojsonvt(shadows, tileOptions)
fs.rmSync(OUT_DIR, { recursive: true, force: true })
const hash = crypto.createHash('sha256')
let tileCount = 0, tileBytes = 0
const coordKey = c => `${c.z}/${c.x}/${c.y}`
const allCoords = new Map()
for (const c of [...index.tileCoords, ...shadowIndex.tileCoords]) allCoords.set(coordKey(c), c)
const coords = [...allCoords.values()].filter(c => c.z >= TILE_MIN_ZOOM).sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y)
for (const { z, x, y } of coords) {
  const layers = {}
  const tile = index.getTile(z, x, y)
  if (tile && tile.features.length > 0) layers.buildings = tile
  const shadowTile = shadowIndex.getTile(z, x, y)
  if (shadowTile && shadowTile.features.length > 0) layers.shadows = shadowTile
  if (Object.keys(layers).length === 0) continue
  const buf = Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2, extent: TILE_EXTENT }))
  const file = path.join(OUT_DIR, String(z), String(x), `${y}.pbf`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
  hash.update(`${z}/${x}/${y}:`).update(buf)
  tileCount++; tileBytes += buf.length
}

// ───────── 결과 요약 ─────────
let lo0 = Infinity, la0 = Infinity, lo1 = -Infinity, la1 = -Infinity
const walk = c => (typeof c[0] === 'number' ? ((lo0 = Math.min(lo0, c[0])), (lo1 = Math.max(lo1, c[0])), (la0 = Math.min(la0, c[1])), (la1 = Math.max(la1, c[1]))) : c.forEach(walk))
parsed.features.forEach(f => walk(f.geometry.coordinates))
fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify({ count: n, bounds: [lo0, la0, lo1, la1].map(v => Math.round(v * 1e6) / 1e6), minzoom: TILE_MIN_ZOOM, maxzoom: TILE_MAX_ZOOM }))
console.log(`원본 건물 ${total.toLocaleString()}개 → 권역 근처 후보 ${nearCount.toLocaleString()}개 → ${BBOX ? '중심점이 권역 안' : '대전 전체'} ${inAreaCount.toLocaleString()}개`)
console.log(`면적 ${MIN_AREA_M2}㎡ 미만 제외 ${tooSmall.toLocaleString()}개 → 남은 건물 ${n.toLocaleString()}개`)
console.log(`층고 중앙값: 저층(1~${LOW_FLOORS_MAX}층) ${lowH.toFixed(2)}m (표본 ${lowRatios.length.toLocaleString()}), 고층(${LOW_FLOORS_MAX + 1}층~) ${highH.toFixed(2)}m (표본 ${highRatios.length.toLocaleString()})`)
console.log(`hSource: height ${srcCount.height ?? 0}, floors ${srcCount.floors ?? 0}, default ${srcCount.default ?? 0}`)
const withFloors = parsed.features.filter(f => f.properties.floors !== null).length
console.log(`floors 있는 비율 ${(withFloors / n * 100).toFixed(1)}% (${withFloors}/${n})`)
console.log(`좌표 범위 bbox [${lo0.toFixed(6)}, ${la0.toFixed(6)}, ${lo1.toFixed(6)}, ${la1.toFixed(6)}]`)
console.log(`타일 z${TILE_MIN_ZOOM}~${TILE_MAX_ZOOM} ${tileCount.toLocaleString()}개  ${(tileBytes / 1024 / 1024).toFixed(1)}MB  ${path.relative(root, OUT_DIR)}  sha256 ${hash.digest('hex').slice(0, 16)}`)
if (tileBytes > WARN_BYTES * 8) console.warn('⚠ 타일 합계가 80MB 를 넘었어요. TILE_MAX_ZOOM 을 낮추거나 tolerance 를 올려보세요.')
