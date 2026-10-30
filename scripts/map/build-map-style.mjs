// OpenFreeMap Positron 스타일 → 보폭 파스텔 스타일(public/map/style.json)
// 실행: pnpm map:style   (원본 스타일은 data/raw/map-style-positron.json 에 한 번 받아 둔다)
// 색·폭·빛·안개 값은 src/lib/map-config.ts 의 PALETTE 등을 그대로 쓴다. (Node 의 타입 제거 기능으로 .ts 를 바로 불러온다)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIGHT, PALETTE, ROAD_WIDTHS, SKY, TEXT_HALO_WIDTH, TEXT_SIZE_SCALE } from '../../src/components/map/map-config.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = path.join(root, 'data/raw/map-style-positron.json')
const OUT = path.join(root, 'public/map/style.json')
const POSITRON_URL = 'https://tiles.openfreemap.org/styles/positron'

if (!fs.existsSync(SRC)) {
  fs.mkdirSync(path.dirname(SRC), { recursive: true })
  const res = await fetch(POSITRON_URL)
  if (!res.ok) throw new Error(`스타일을 받지 못했어요: ${res.status}`)
  fs.writeFileSync(SRC, await res.text())
}
const style = JSON.parse(fs.readFileSync(SRC, 'utf8'))

const interp = stops => ['interpolate', ['linear'], ['zoom'], ...stops.flat()]
const NAME_KO = ['coalesce', ['get', 'name:ko'], ['get', 'name']]

const BIG_ROADS = ['highway_major_inner', 'highway_motorway_inner', 'highway_motorway_bridge_inner', 'tunnel_motorway_inner', 'highway_major_subtle', 'highway_motorway_subtle']
const PATHS = ['highway_path']
const MINOR_ROADS = ['highway_minor']
const SOFT_LINES = ['railway_transit', 'railway_service', 'railway']
const HIDE = new Set([
  // 도로 테두리는 모두 숨긴다
  'highway_major_casing', 'highway_motorway_casing', 'highway_motorway_bridge_casing', 'tunnel_motorway_casing',
  // 도로 번호 방패, 작은 도로명
  'highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us', 'highway-name-path', 'highway-name-minor',
  // 원래 건물(우리 데이터로 따로 그린다)
  'building',
])

// 글자 크기를 한 단계 작게: 숫자면 곱하고, interpolate/step 이면 출력값(숫자)만 곱한다(zoom 식은 최상위에만 둘 수 있어서 식 전체를 감쌀 수 없다)
function scaleSize(v) {
  if (typeof v === 'number') return Math.round(v * TEXT_SIZE_SCALE * 10) / 10
  if (Array.isArray(v) && (v[0] === 'interpolate' || v[0] === 'step')) {
    const head = v[0] === 'interpolate' ? 3 : 2
    return v.map((x, i) => (i > head && (i - head) % 2 === 1 && typeof x === 'number' ? Math.round(x * TEXT_SIZE_SCALE * 10) / 10 : x))
  }
  throw new Error('처리하지 못하는 text-size: ' + JSON.stringify(v))
}

const layers = []
for (const layer of style.layers) {
  const l = structuredClone(layer)
  const id = l.id
  l.paint ??= {}
  l.layout ??= {}
  if (HIDE.has(id)) l.layout.visibility = 'none'

  if (id === 'background') l.paint['background-color'] = PALETTE.background
  if (id === 'landuse_residential') l.paint['fill-color'] = PALETTE.background
  if (id === 'park') l.paint['fill-color'] = PALETTE.park
  if (id === 'landcover_wood') l.paint['fill-color'] = PALETTE.forest
  if (id === 'water') l.paint['fill-color'] = PALETTE.water
  if (id === 'waterway') l.paint['line-color'] = PALETTE.water
  if (id === 'road_area_pier') l.paint['fill-color'] = PALETTE.background
  if (id === 'road_pier') l.paint['line-color'] = PALETTE.background

  const road = (color, widths) => { l.paint['line-color'] = color; l.paint['line-width'] = interp(widths); l.paint['line-opacity'] = 1; delete l.paint['line-dasharray'] }
  if (BIG_ROADS.includes(id)) road(PALETTE.roadMajor, ROAD_WIDTHS.major)
  if (MINOR_ROADS.includes(id)) road(PALETTE.roadMinor, ROAD_WIDTHS.minor)
  if (PATHS.includes(id)) road(PALETTE.roadPath, ROAD_WIDTHS.path)
  if (SOFT_LINES.includes(id)) { l.paint['line-color'] = PALETTE.roadPath }
  if (id.startsWith('railway') && id.endsWith('dashline')) l.paint['line-color'] = PALETTE.background

  if (l.type === 'symbol') {
    if (l.paint['text-color'] !== undefined || l.layout['text-field'] !== undefined) {
      l.paint['text-color'] = PALETTE.text
      l.paint['text-halo-color'] = PALETTE.textHalo
      l.paint['text-halo-width'] = TEXT_HALO_WIDTH
      if (l.layout['text-size'] !== undefined) l.layout['text-size'] = scaleSize(l.layout['text-size'])
    }
    if (Array.isArray(l.layout['text-field']) && JSON.stringify(l.layout['text-field']).includes('name_en')) l.layout['text-field'] = NAME_KO
    // 마을·도시 이름 옆 점·공항 같은 작은 아이콘은 쓰지 않는다
    delete l.layout['icon-image']
  }
  layers.push(l)
}

// 작은 도로에는 원래 테두리가 없었다. 테두리를 쓰지 않기로 해서 따로 만들지 않는다.

style.layers = layers
style.light = { ...LIGHT }
style.sky = { 'sky-color': PALETTE.sky, 'horizon-color': PALETTE.sky, 'fog-color': PALETTE.sky, ...SKY }
fs.writeFileSync(OUT, JSON.stringify(style, null, 1))
console.log(`style.json: 레이어 ${layers.length}개, 숨김 ${layers.filter(x => x.layout.visibility === 'none').length}개 → ${path.relative(root, OUT)}`)
