// 3D 지도 설정 값 (기본 카메라: 엑스포과학공원·한밭수목원 일대)

// ───────── 팔레트 (파스텔 지도) ─────────
// 핑크빛이 도는 아주 연한 바탕 + 흰 건물 + 가는 회보라 도로 + 연보라 그림자 + 세이지 공원.
// 이전 값은 각 줄 끝에 적어 두었다. style.json 은 scripts/build-map-style.mjs 가 이 값으로 다시 만든다.
export const PALETTE = {
  background: '#F8F4F6',     // 이전 #F3F1EC
  park: '#C8D5B9',           // 이전 #D6EBC8
  forest: '#BCCDAA',         // 이전 #D6EBC8
  water: '#D6E4F0',          // 이전 #BFDDF0
  roadMajor: '#B7BBC9',      // 이전 #FFFFFF (+테두리 #E4E0D8)
  roadMinor: '#CDCFDA',      // 이전 #FFFFFF
  roadPath: '#DADCE5',       // 이전 #FFFFFF
  text: '#8E8A99',           // 이전 #8A847B
  textHalo: '#FFFFFF',
  buildingLow: '#FBF9FC',    // 이전 #F4EFE8 (낮은 건물)
  buildingHigh: '#F3F0F7',   // 이전 #D9E4F2 (높은 건물)
  buildingDefault: '#FDFCFD', // 높이 정보가 없어 기본 6m 로 정한 건물
  buildingFar: '#F1EEF3',    // 구간만 보기에서 범위 밖 건물. 이전 #EEEBE6
  shadow: '#CFC6DC',         // 새로 추가
  trunk: '#B9A99A',          // 새로 추가
  crowns: ['#B5C7A0', '#A3BA8E'] as [string, string], // 새로 추가(둘 사이 랜덤)
  sky: '#F8F4F6',           // 하늘·안개도 바탕색
}
// 도로 폭(px) [줌, 폭] 끝점. 줌이 커질수록 굵어진다
export const ROAD_WIDTHS = {
  major: [[10, 1.5], [18, 4]] as [number, number][],
  minor: [[13, 0.8], [18, 2.5]] as [number, number][],
  path: [[14, 0.5], [18, 1.2]] as [number, number][],
}
// 글자: 크기를 한 단계 작게(원래 크기에 곱한다), 테두리 폭
export const TEXT_SIZE_SCALE = 0.88
export const TEXT_HALO_WIDTH = 1.5
// 빛은 약하고 고르게, 하늘·안개는 바탕색으로 지평선이 흐려지게
export const LIGHT = { anchor: 'map', color: '#FFFFFF', intensity: 0.15, position: [1.5, 210, 30] }
export const SKY = { 'fog-ground-blend': 0.4, 'horizon-fog-blend': 0.9, 'sky-horizon-blend': 1 }

export const MAP_STYLE_URL = '/map/style.json'
// 번들러가 워커 경로를 깨뜨려서, scripts/copy-map-assets.mjs 가 복사한 파일을 직접 불러온다
export const MAP_WORKER_URL = '/map/maplibre-gl-worker.mjs'

export const MAP_CENTER = { longitude: 127.385, latitude: 36.372 }
export const MAP_ZOOM = 15.2
export const MAP_PITCH = 60
export const MAP_BEARING = -20

// 대전 전체(경계 bbox)가 1440×900 화면에 딱 들어오는 줌. scripts/build-boundary.mjs 가 계산한 값
export const MAP_MIN_ZOOM = 10.65
export const MAP_MAX_ZOOM = 18
// 대전 경계 bbox 에서 사방 2km 여유 [서, 남, 동, 북]. scripts/build-boundary.mjs 가 계산한 값
export const MAP_MAX_BOUNDS: [number, number, number, number] = [127.224014, 36.165281, 127.56317, 36.518299]

// 기울기 제한: 줌아웃할수록 덜 기울게. [줌, 최대 pitch] 사이는 직선으로 잇는다(그 밖은 양 끝 값)
// 줌 12 이하 35°, 줌 14 에서 50°, 줌 15.5 이상 60°. 그보다 더 기울면 지평선에 대전 밖이 보인다
export const MAP_MAX_PITCH = 60
export const MAP_PITCH_LIMITS: [number, number][] = [[12, 35], [14, 50], [15.5, 60]]

export const MAP_FLAT_DURATION_MS = 800
export const MAP_BG_COLOR = PALETTE.background
export const MAP_FONT_FAMILY = "'Pretendard', 'Noto Sans KR', sans-serif"

// 3D 건물 (scripts/build-buildings.mjs 가 만든 파일)
// 대전 전체 건물 벡터 타일(z14~16, 그 위로 확대하면 늘려서 쓴다)
export const BUILDINGS_TILES = '/tiles/buildings/{z}/{x}/{y}.pbf'
export const BUILDINGS_SOURCE_LAYER = 'buildings'
export const BUILDINGS_MIN_ZOOM = 14
export const BUILDINGS_MAX_ZOOM = 16
export const BUILDINGS_SOURCE_ID = 'buildings'
export const BUILDINGS_NEAR_LAYER_ID = 'buildings-near'
export const BUILDINGS_FAR_LAYER_ID = 'buildings-far'
// 건물은 땅·공원·물 위, 도로·지명 아래. 숨겨 둔 원래 건물 레이어 다음에 오는 첫 도로 레이어 앞에 끼운다
export const BUILDINGS_BEFORE_ID = 'tunnel_motorway_casing'
export const BUILDINGS_FALLBACK_H = 6

// 경로 선·핀
export const ROUTE_SOURCE_ID = 'routes'
// 건물 위, 지명(글자) 아래
export const ROUTE_BEFORE_ID = 'waterway_line_label'
export const ROUTE_COLORS = {
  ok: '#1D4ED8',      // 조건 충족
  warn: '#EA580C',    // 조정 필요
  info: '#A8A196',    // 정보 부족
  ride: '#8A847B',    // 탈것 구간
  casing: '#FFFFFF',
}

// 구간만 보기
export const FOCUS_PITCH = 60
export const FOCUS_MOVE_MS = 900
export const FOCUS_RISE_MS = 500
// 범위 밖 건물: 높이 배율 / 색 / 진하기
export const FAR_HEIGHT_SCALE = 0.35
export const FAR_COLOR = PALETTE.buildingFar
export const FAR_OPACITY = 0.3
export const VEIL_OPACITY = 0.45
export const VEIL_SOURCE_ID = 'focus-veil'

// ───────── 그림자 (scripts/build-buildings.mjs 가 건물 타일에 'shadows' 레이어로 함께 담는다) ─────────
// 해가 반대편이라 그림자는 이 방위(북동쪽 40도)로 건물 높이 × 비율 만큼 늘어진다
export const SHADOW_BEARING_DEG = 40
export const SHADOW_LENGTH_RATIO = 0.8
export const SHADOW_OPACITY = 0.35
export const SHADOW_FAR_OPACITY = 0.12
export const BUILDINGS_SHADOW_SOURCE_LAYER = 'shadows'
export const BUILDINGS_SHADOW_NEAR_LAYER_ID = 'shadows-near'
export const BUILDINGS_SHADOW_FAR_LAYER_ID = 'shadows-far'

// ───────── 나무 (scripts/build-trees.mjs, 시연 권역만) ─────────
// maplibre 커스텀 레이어 + three.js InstancedMesh 로 나무 점마다 구(수관)와 원기둥(줄기)을 그린다(src/components/map/treesLayer.ts)
export const TREES_URL = '/data/daejeon-trees.json'
export const TREES_LAYER_ID = 'trees-3d'
export const TREES_MIN_ZOOM = 15
// [서, 남, 동, 북]
export const TREE_BBOX: [number, number, number, number] = [127.370, 36.360, 127.400, 36.385]
export const TREE_MAX_COUNT = 3000
export const TREE_MIN_SPACING_M = 12
export const TREE_CROWN_RADIUS_M: [number, number] = [3, 4.5]
export const TREE_TRUNK_RADIUS_M = 0.6
// 수관은 위아래로 살짝 눌린 구(1 = 완전한 구), 줄기는 수관 중심까지
export const TREE_CROWN_SQUASH = 0.88
export const TREE_LIGHT = { ambient: 1.0, directional: 0.28 } // 부드럽고 고른 빛(그림자 없음)
export const TREE_CROWN_TOP_M: [number, number] = [8, 11]

// ───────── 대전 밖 덮기 (scripts/build-boundary.mjs, © OpenStreetMap contributors) ─────────
// 건물 데이터가 대전에만 있어서, 세계 전체에서 대전 경계를 뚫은 마스크를 바탕색으로 덮어 대전만 보이게 한다
export const BOUNDARY_URL = '/data/daejeon-boundary.geojson'
export const MASK_URL = '/data/daejeon-mask.geojson'
export const MASK_SOURCE_ID = 'daejeon-mask'
export const BOUNDARY_SOURCE_ID = 'daejeon-boundary'
export const BOUNDARY_LINE = { color: '#C9C2D6', width: 1.5 }
export const BOUNDARY_GLOW = { color: '#D9D3E3', width: 10, blur: 8, opacity: 0.6 }

// ───────── 둘러보기(landing) 연출과 맞물리는 값 ─────────
// 건물이 솟는 것은 시간이 아니라 줌에 맞춘다(GPU 가 줌으로 보간해서 프레임마다 JS 가 건물 전체를 다시 계산하지 않는다).
// 내려앉는 카메라가 이 줌 구간을 지나는 동안 건물 높이가 0 → 1 로 커진다
export const RISE_ZOOM: [number, number] = [14.7, 15.5]
// 지도 화면 해상도(devicePixelRatio) 상한. 고해상도 휴대폰에서 매 프레임 그리는 픽셀 수를 줄인다
export const PIXEL_RATIO_MAX = 2
export const PIXEL_RATIO_MAX_COMPACT = 1.5
// 화장실 핀 표시 여부(설계 13장: 데이터는 모으고 화면 표시는 설정값으로 켜고 끈다)
export const FEATURE_TOILET = false
