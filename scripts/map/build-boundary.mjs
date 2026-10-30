// 대전광역시 행정경계(OpenStreetMap admin_level=4) → 경계 도형과 "대전 밖을 덮는 마스크" GeoJSON
// 실행: pnpm data:boundary   (앱이 실행 중에는 외부 요청을 하지 않는다. 이 스크립트만 한 번 Overpass 에서 받는다)
// 출처: © OpenStreetMap contributors (ODbL). data/README.md 참고
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import osmtogeojson from 'osmtogeojson'
import { area, bbox, mask, simplify } from '@turf/turf'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW = path.join(root, 'data/raw/osm-daejeon-boundary.json')
const OUT_BOUNDARY = path.join(root, 'public/data/daejeon-boundary.geojson')
const OUT_MASK = path.join(root, 'public/data/daejeon-mask.geojson')
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const SIMPLIFY_DEG = 0.0004   // 약 40m. 경계선이 너무 많은 꼭짓점을 갖지 않게
const MARGIN_KM = 2           // maxBounds 여유
const FIT_VIEWPORT = [1440, 900] // "대전 전체가 한 화면에 들어오는 줌"을 계산하는 데스크톱 화면(px)
const TILE = 512              // maplibre 타일 크기

if (!fs.existsSync(RAW)) {
  const query = '[out:json][timeout:90];relation["boundary"="administrative"]["admin_level"="4"]["name"="대전광역시"];out geom;'
  const res = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': 'bopok-build-script/1.0 (data prep)', Accept: 'application/json' }, body: new URLSearchParams({ data: query }) })
  if (!res.ok) throw new Error(`Overpass 요청 실패: ${res.status}`)
  fs.mkdirSync(path.dirname(RAW), { recursive: true })
  fs.writeFileSync(RAW, await res.text())
}
const features = osmtogeojson(JSON.parse(fs.readFileSync(RAW, 'utf8'))).features
  .filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
if (features.length === 0) throw new Error('대전 경계 도형을 찾지 못했어요')
// 가장 넓은 도형 하나(대전광역시 행정구역)
const main = features.sort((a, b) => area(b) - area(a))[0]
const boundary = simplify({ type: 'Feature', properties: { name: '대전광역시' }, geometry: main.geometry }, { tolerance: SIMPLIFY_DEG, highQuality: true })
const polygons = boundary.geometry.type === 'Polygon' ? [boundary.geometry.coordinates] : boundary.geometry.coordinates
// 경계 안 작은 구멍(거의 없음)이나 잔여 조각이 생기면 마스크가 어긋나므로 바깥 고리만 확인해 둔다
const vertices = polygons.reduce((s, p) => s + p.reduce((t, r) => t + r.length, 0), 0)

// 세계 전체 사각형에서 대전 경계를 뚫은 마스크
const worldRect = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }
const masked = mask(boundary, worldRect)

const r6 = v => Math.round(v * 1e6) / 1e6
const round = c => (typeof c[0] === 'number' ? c.map(r6) : c.map(round))
for (const f of [boundary, masked]) f.geometry.coordinates = round(f.geometry.coordinates)
fs.mkdirSync(path.dirname(OUT_BOUNDARY), { recursive: true })
const boundaryText = JSON.stringify(boundary)
const maskText = JSON.stringify(masked)
fs.writeFileSync(OUT_BOUNDARY, boundaryText)
fs.writeFileSync(OUT_MASK, maskText)

// ───────── map-config.ts 에 넣을 값 계산 ─────────
const [w, s, e, n] = bbox(boundary)
const midLat = (s + n) / 2
const dLat = MARGIN_KM / 110.574
const dLon = MARGIN_KM / (111.32 * Math.cos((midLat * Math.PI) / 180))
const maxBounds = [r6(w - dLon), r6(s - dLat), r6(e + dLon), r6(n + dLat)]
// 대전 전체(bbox)가 화면에 딱 들어오는 줌(세로는 메르카토르 늘어남을 반영)
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI * 180
const spanX = e - w
const spanY = mercY(n) - mercY(s)
const zoomFor = (px, spanDeg) => Math.log2((px * 360) / (TILE * spanDeg))
const fitZoom = Math.min(zoomFor(FIT_VIEWPORT[0], spanX), zoomFor(FIT_VIEWPORT[1], spanY))

console.log(`경계: 꼭짓점 ${vertices.toLocaleString()}개, bbox [${[w, s, e, n].map(r6).join(', ')}]`)
console.log(`파일: ${path.relative(root, OUT_BOUNDARY)} ${(boundaryText.length / 1024).toFixed(0)}KB, ${path.relative(root, OUT_MASK)} ${(maskText.length / 1024).toFixed(0)}KB, sha256 ${crypto.createHash('sha256').update(boundaryText + maskText).digest('hex').slice(0, 16)}`)
console.log(`MAP_MAX_BOUNDS = [${maxBounds.join(', ')}]  (대전 bbox + 사방 ${MARGIN_KM}km)`)
console.log(`MAP_MIN_ZOOM ≈ ${fitZoom.toFixed(2)}  (${FIT_VIEWPORT.join('×')}px 화면에 대전 전체가 들어오는 줌, 소수 둘째 자리 내림 = ${Math.floor(fitZoom * 100) / 100})`)
