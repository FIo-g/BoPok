// 공원·숲·잔디 면 안에 나무 위치를 흩뿌려 나무 점 데이터(public/data/daejeon-trees.json)로 만든다 (시연 권역만)
// 지도는 이 점마다 three.js 로 구(수관)와 원기둥(줄기)을 그린다. 건물 바닥 위에는 놓지 않는다(data/raw/derived/buildings-footprints.json, pnpm data:buildings 가 만든다)
// 실행: pnpm data:trees (pnpm data:buildings 가 이어서 실행한다)
// 공원 면은 OpenStreetMap(Overpass API)에서 시연 권역 범위만 한 번 받아 data/raw/osm-green-demo.json 에 저장해서 쓴다.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import osmtogeojson from 'osmtogeojson'
import { isClearOfRings, mulberry32, scatterInPolygon } from './lib/geometry.mjs'
import {
  PALETTE, TREE_BBOX, TREE_CROWN_RADIUS_M, TREE_CROWN_TOP_M, TREE_MAX_COUNT, TREE_MIN_SPACING_M,
} from '../../src/components/map/map-config.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW = path.join(root, 'data/raw/osm-green-demo.json')
const OUT = path.join(root, 'public/data/daejeon-trees.json')
const FOOTPRINTS = path.join(root, 'data/raw/derived/buildings-footprints.json')
const SEED = 20261029
const AREA_PER_TREE_M2 = 400     // 면적 이만큼당 한 그루 정도(최소 간격 때문에 실제로는 조금 적다)
const OVERPASS = 'https://overpass-api.de/api/interpreter'

// ───────── 1) OSM 에서 공원·숲·잔디 면 받기 (한 번만) ─────────
if (!fs.existsSync(RAW)) {
  const [w, s, e, n] = TREE_BBOX
  const box = `${s},${w},${n},${e}`
  const query = `[out:json][timeout:90];(
    way["leisure"~"^(park|garden|common)$"](${box});
    way["landuse"~"^(forest|grass|meadow|recreation_ground|village_green)$"](${box});
    way["natural"~"^(wood|scrub|grassland)$"](${box});
    relation["leisure"~"^(park|garden)$"](${box});
    relation["landuse"~"^(forest|grass|meadow|recreation_ground)$"](${box});
    relation["natural"~"^(wood|scrub|grassland)$"](${box});
  );out geom;`
  const res = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': 'bopok-build-script/1.0 (data prep)', Accept: 'application/json' }, body: new URLSearchParams({ data: query }) })
  if (!res.ok) throw new Error(`Overpass 요청 실패: ${res.status}`)
  fs.mkdirSync(path.dirname(RAW), { recursive: true })
  fs.writeFileSync(RAW, await res.text())
}
const osm = JSON.parse(fs.readFileSync(RAW, 'utf8'))
const polygons = osmtogeojson(osm).features
  .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
  .flatMap(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates))

// ───────── 2) 미터 단위 평면 좌표(권역 중심 기준)로 바꿔서 나무 위치 흩뿌리기 ─────────
const lat0 = (TREE_BBOX[1] + TREE_BBOX[3]) / 2, lon0 = (TREE_BBOX[0] + TREE_BBOX[2]) / 2
const M_PER_DEG_LAT = 110574
const M_PER_DEG_LON = 111320 * Math.cos((lat0 * Math.PI) / 180)
const toXY = ([lon, lat]) => [(lon - lon0) * M_PER_DEG_LON, (lat - lat0) * M_PER_DEG_LAT]

const rng = mulberry32(SEED)
const occupied = new Map()
let points = []
for (const rings of polygons.map(p => p.map(r => r.map(toXY)))) {
  points.push(...scatterInPolygon(rings, { rng, minSpacing: TREE_MIN_SPACING_M, areaPerTree: AREA_PER_TREE_M2, occupied }))
}
// 건물 바닥 위에는 놓지 않는다(수관 반지름만큼 여유)
let blocked = 0
if (fs.existsSync(FOOTPRINTS)) {
  const footprints = JSON.parse(fs.readFileSync(FOOTPRINTS, 'utf8')).map(r => r.map(toXY))
  const before = points.length
  points = points.filter(p => isClearOfRings(p, TREE_CROWN_RADIUS_M[1], footprints))
  blocked = before - points.length
} else {
  console.warn('⚠ buildings-footprints.json 이 없어서 건물 피하기를 건너뛰었어요. pnpm data:buildings 로 먼저 만드세요.')
}
// 권역 전체 최대 그루 수를 넘으면 난수로 골고루 덜어낸다
const candidates = points.length
if (points.length > TREE_MAX_COUNT) {
  const order = points.map((p, i) => [rng(), i]).sort((a, b) => a[0] - b[0]).slice(0, TREE_MAX_COUNT).map(x => x[1]).sort((a, b) => a - b)
  points = order.map(i => points[i])
}

// ───────── 3) 나무 점 데이터 ─────────
// 좌표는 권역 중심(origin)에서 동쪽·북쪽으로 몇 미터인지. 지도 쪽 three.js 레이어가 그대로 쓴다
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')
const between = ([a, b], t) => Math.round((a + (b - a) * t) * 10) / 10
const r1 = v => Math.round(v * 10) / 10
// [동쪽 m, 북쪽 m, 수관 반지름 m, 나무 꼭대기 높이 m, 수관 색]
const trees = points.map(p => [r1(p[0]), r1(p[1]), between(TREE_CROWN_RADIUS_M, rng()), between(TREE_CROWN_TOP_M, rng()), mix(PALETTE.crowns[0], PALETTE.crowns[1], rng())])
const text = JSON.stringify({ origin: [r6(lon0), r6(lat0)], count: trees.length, trees })
function r6(v) { return Math.round(v * 1e6) / 1e6 }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, text)

console.log(`공원·숲·잔디 면 ${polygons.length}개 → 나무 후보 ${candidates.toLocaleString()}그루 (건물 위 ${blocked.toLocaleString()}그루 제외) → ${trees.length.toLocaleString()}그루 (최대 ${TREE_MAX_COUNT.toLocaleString()}, 최소 간격 ${TREE_MIN_SPACING_M}m)`)
console.log(`파일 ${path.relative(root, OUT)} ${(text.length / 1024).toFixed(0)}KB sha256 ${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`)
