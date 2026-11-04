// 지도에 세우는 랜드마크 3D 모형 3곳 (시연용). 값은 모두 고정값이고 런타임에 계산하지 않는다.
// 위치·방향·크기는 건물 벡터 타일(public/tiles/buildings, 줌 16)의 건물 바닥 모양에서 구했다:
//  - 중심 = 바닥 모양의 무게중심
//  - bearingDeg = 최소 회전 사각형의 긴 변 방향(모형의 긴 변은 X축). 북쪽에서 시계 방향 도(°)
//  - scale = 바닥 모양 긴 변 ÷ 모형 긴 변(0.8~1.3)에서 출발해, 주변 건물보다 확실히 두드러지도록 키웠다(최대 2.0), 높이는 heightScale 로 더 키웠다
//  - 위에서 본 화면에서 바닥 윤곽과 겹쳐 보고 중심·방향을 몇 m, 몇 도 보정했다
//  - hideFids = 모형이 대신하는 원래 건물의 fid. 줌이 가까워지면 서서히 사라진다
// 장소 좌표는 OpenStreetMap(Nominatim) 조회값으로 확인했다(© OpenStreetMap contributors).

export type Landmark = {
  id: string
  name: string
  // public/models 의 파일 이름
  model: string
  lng: number
  lat: number
  // 모형을 놓는 중심(lng, lat)에 더하는 이동(미터, [동쪽, 북쪽]). GLB 원점이 건물 본체 중심이 아니라 bbox 중심이라
  // (캐노피·열주·받침대 때문에 밀림) 본체가 원래 건물 바닥과 겹치도록 보정한다
  offsetM: [number, number]
  // 원래 건물 바닥 모양의 긴 변(m). 바닥 글로우 반지름(0.75배)에 쓴다
  footprintLongM: number
  // 모형 +X 축이 가리키는 방위(북 기준 시계 방향, 도)
  bearingDeg: number
  scale: number
  // 높이 방향만 더 키우는 배율. 주변 건물보다 우뚝 솟아 보이게 한다
  heightScale: number
  hideFids: number[]
  // 장소 데이터(demo-geo)의 장소 id. 있으면 모형을 눌렀을 때 그 장소로 연결한다
  placeId?: string
  // ───────── 상세 화면(모형을 누르면 열린다) ─────────
  // 사진: public/images/landmarks/<id>.webp (scripts/build-landmark-images.mjs 가 팀이 준 실사 사진을 300KB 아래로 줄인 것)
  image: string
  imageAlt: string
  summary: string
  // 동네 한 줄
  area: string
  // 칩으로 보여 줄 말(최대 3개)
  tags: string[]
  // 카메라가 다가갈 줌(큰 곳은 낮춘다)
  detailZoom: number
  // 카메라가 건물 앞에서 바라보는 방위. 없으면 landmarkViewBearing 이 모형의 앞(+Z)을 마주 보는 방향으로 정한다
  viewBearingDeg?: number
  // 숨길 건물이 없는 곳(다리·광장)의 위치 미니맵 도형: [긴 변, 짧은 변] 미터. bearingDeg 방향으로 놓는다
  miniShapeM?: [number, number]
}

export const LANDMARKS: Landmark[] = [
  {
    id: 'science-museum', name: '국립중앙과학관', model: 'science-museum.glb',
    lng: 127.375263, lat: 36.375062, offsetM: [14, 28], footprintLongM: 116, bearingDeg: 355.8, scale: 1.3, heightScale: 1.3,
    hideFids: [96430, 11060, 96431, 11075], placeId: '국립중앙과학관',
    image: '/images/landmarks/science-museum.webp', imageAlt: '국립중앙과학관 외관 사진',
    summary: '자연사·과학기술 전시관과 천체관을 갖춘 국립 과학관이에요. 원반 모양 지붕이 상징이고, 전시관 사이 이동 거리가 길어 쉬는 곳을 미리 정해두면 좋아요.',
    area: '유성구 · 대덕연구단지', tags: ['전시', '천체관', '넓은 부지'], detailZoom: 17.3,
  },
  {
    id: 'arts-center', name: '대전예술의전당', model: 'arts-center.glb',
    lng: 127.383798, lat: 36.366591, offsetM: [3, 6], footprintLongM: 145, bearingDeg: 90, scale: 1.3, heightScale: 1.3,
    hideFids: [133229],
    image: '/images/landmarks/arts-center.webp', imageAlt: '대전예술의전당 외관 사진',
    summary: '대전의 대표 공연장이에요. 큰 공연장과 작은 공연장이 함께 있어 공연 전후 동선이 길어질 수 있어요.',
    area: '서구 · 둔산대공원', tags: ['공연장', '로비 휴식'], detailZoom: 17.3,
  },
  {
    id: 'art-museum', name: '대전시립미술관', model: 'art-museum.glb',
    lng: 127.385743, lat: 36.366824, offsetM: [-3, 9], footprintLongM: 88, bearingDeg: 94, scale: 1.25, heightScale: 1.3,
    hideFids: [118740], placeId: '대전시립미술관',
    image: '/images/landmarks/art-museum.webp', imageAlt: '대전시립미술관 외관 사진',
    summary: '둔산대공원 안의 시립 미술관이에요. 근현대 미술 기획전이 열리고, 예술의전당·한밭수목원과 걸어서 이어져요.',
    area: '서구 · 둔산대공원', tags: ['미술관', '공원 연결'], detailZoom: 17.3,
  },
  // 한밭수목원 열대식물원(온실): 바닥 모양 74.5×45.9m 가 모형(75×51m)과 거의 같은 fid 140185
  {
    id: 'hanbat-greenhouse', name: '한밭수목원 열대식물원', model: 'hanbat-arboretum.glb',
    lng: 127.392562, lat: 36.367784, offsetM: [-6, 3], footprintLongM: 75, bearingDeg: 90, scale: 0.95, heightScale: 1.3,
    hideFids: [140185], placeId: '한밭수목원',
    image: '/images/landmarks/hanbat-greenhouse.webp', imageAlt: '한밭수목원 열대식물원 유리온실 사진',
    summary: '열대 식물을 실내에서 볼 수 있는 유리온실이에요. 날씨와 상관없이 둘러볼 수 있어 수목원 산책 중 쉬어가기 좋아요.',
    area: '서구 · 한밭수목원', tags: ['실내', '식물원', '날씨 무관'], detailZoom: 17.3,
  },
  // 기초과학연구원 도서관: 연구원 터에서 모형(78×42m)과 모양이 가장 닮은 fid 106589(72.6×40.7m, 남북 방향). 건물 이름은 지도 데이터에 없어 모양으로 고른 것이라 확인이 필요하다
  {
    id: 'ibs-library', name: '기초과학연구원 도서관', model: 'ibs-library.glb',
    lng: 127.387171, lat: 36.377117, offsetM: [3, -8], footprintLongM: 73, bearingDeg: 0.3, scale: 0.95, heightScale: 1.3,
    hideFids: [106589],
    image: '/images/landmarks/ibs-library.webp', imageAlt: '기초과학연구원 도서관 외관 사진',
    summary: '엑스포과학공원 옆 기초과학연구원 캠퍼스의 과학문화 공간이에요. 곡선 유리 띠가 이어지는 외관이 특징이에요.',
    area: '유성구 · 엑스포과학공원', tags: ['과학문화', '실내'], detailZoom: 17.3,
  },
  // 엑스포다리(갑천 위 남북 방향 보행교). 다리에는 숨길 건물이 없다. 좌표는 OpenStreetMap 의 다리 가운데
  {
    id: 'expo-bridge', name: '엑스포다리', model: 'expo-bridge.glb',
    lng: 127.38804, lat: 36.37261, offsetM: [0, 12], footprintLongM: 120, bearingDeg: 0, scale: 1.2, heightScale: 1,
    hideFids: [],
    image: '/images/landmarks/expo-bridge.webp', imageAlt: '엑스포다리 사진',
    summary: '갑천을 가로지르는 보행자 전용 다리예요. 과학관 쪽과 둔산 쪽을 걸어서 잇고, 저녁 조명이 예뻐요.',
    area: '갑천 · 엑스포과학공원 앞', tags: ['보행 전용', '강변', '야경'], detailZoom: 16.6, miniShapeM: [204, 10],
  },
  // 대전엑스포 시민광장: 한빛탑 앞에서 엑스포다리까지 이어지는 엑스포과학공원 안의 광장 구역(물빛광장 음악분수·야외공연장·무빙쉘터).
  // 엑스포로 북쪽, 한빛탑(36.3766, 127.3881)과 엑스포다리 북쪽 끝(36.3741) 사이의 남북으로 긴 포장 광장에 놓는다. 지도에 이 광장의 이름·바닥 윤곽이 없어 위치는 추정이라 확인이 필요하다
  {
    id: 'expo-plaza', name: '대전엑스포 시민광장', model: 'expo-plaza.glb',
    lng: 127.38807, lat: 36.3753, offsetM: [0, 0], footprintLongM: 147, bearingDeg: 0, scale: 1.1, heightScale: 1,
    hideFids: [],
    image: '/images/landmarks/expo-plaza.webp', imageAlt: '대전엑스포 시민광장 사진',
    summary: '큰 지붕 아래 열린 광장이에요. 행사가 자주 열리고, 그늘이 넓어 이동 중 쉬기 좋아요.',
    area: '유성구 · 엑스포과학공원', tags: ['광장', '그늘', '행사'], detailZoom: 16.6, miniShapeM: [147, 68],
  },
]

export const LANDMARK_SCALE_RANGE: [number, number] = [0.8, 2]
export const LANDMARKS_LAYER_ID = 'landmarks-3d'
export const LANDMARK_MODEL_DIR = '/models/'
// 모형이 서서히 나타나는 줌 구간(그보다 멀리서는 보이지 않는다). 원래 건물은 같은 구간에서 사라진다
export const LANDMARK_FADE_ZOOM: [number, number] = [14.5, 15.5]
// 숨긴 원래 건물을 줌으로 서서히 지우는 전용 레이어(레이어 단위로만 진하기를 바꿀 수 있어서 따로 둔다)
export const LANDMARK_HIDDEN_LAYER_ID = 'buildings-landmark-hidden'
export const LANDMARK_HIDDEN_SHADOW_LAYER_ID = 'shadows-landmark-hidden'

// ───────── 푸른빛 강조 ─────────
// 주변 건물(#F4F2F6)과 구분되게 파스텔 푸른 톤을 섞는다. 기존 투톤(벽·지붕·유리)은 그대로 두고 색만 바꾼다
export const LANDMARK_MATERIAL_COLORS: Record<string, string> = {
  wall: '#E3EAFB',
  roof: '#EEF3FE',
  glass: '#BFD3F8',
  trim: '#F3F7FE', // 테두리·기둥: 지붕 색 가까이
  green: '#CFE6F4', // 정원·옥상 녹지: 푸른 기가 도는 연한 색
  slit: '#D2DFF8', // 틈: 벽보다 살짝 진하게
}
export const LANDMARK_FALLBACK_COLOR = '#E3EAFB'
export const LANDMARK_GLASS_OPACITY = 0.85
export const LANDMARK_STYLE = {
  emissive: '#3B82F6',
  // 숨쉬기: 3초 주기로 0.12 ↔ 0.22. 움직임 줄이기·휴대폰에서는 고정값
  emissiveMin: 0.12,
  emissiveMax: 0.22,
  emissiveFixed: 0.18,
  emissiveActive: 0.3, // 호버·선택
  breathMs: 3000,
  rimColor: '#60A5FA',
  rimStrength: 0.35,
  glowColor: '#93C5FD',
  glowAlpha: 0.35, // 중심 알파(가장자리는 0)
  glowAlphaActive: 0.5,
  glowRadiusRatio: 0.75, // × footprint 긴 변
} as const

// 모형을 놓는 실제 중심 [경도, 위도]: 기준 좌표 + offsetM
export function landmarkCenter(l: Pick<Landmark, 'lng' | 'lat' | 'offsetM'>): [number, number] {
  const metersPerLng = 111320 * Math.cos((l.lat * Math.PI) / 180)
  return [l.lng + l.offsetM[0] / metersPerLng, l.lat + l.offsetM[1] / 110574]
}

export const landmarkById = (id: string | null | undefined, landmarks: Landmark[] = LANDMARKS): Landmark | undefined =>
  id ? landmarks.find(l => l.id === id) : undefined

// 상세 화면에서 카메라가 바라보는 방위. 모형의 앞(+Z 축, 방위 bearingDeg + 90)을 마주 보려고 그 반대(bearingDeg - 90)를 본다
export function landmarkViewBearing(l: Pick<Landmark, 'bearingDeg' | 'viewBearingDeg'>): number {
  if (l.viewBearingDeg !== undefined) return l.viewBearingDeg
  return Math.round((((l.bearingDeg - 90) % 360) + 360) % 360 * 10) / 10
}

// 건물이 없는 곳(다리·광장)을 미니맵에 칠할 방향 있는 직사각형의 모서리 [경도, 위도] 5개(닫힌 고리). miniShapeM 이 없으면 null
export function landmarkRectCoords(l: Pick<Landmark, 'lng' | 'lat' | 'offsetM' | 'bearingDeg' | 'miniShapeM'>): [number, number][] | null {
  if (!l.miniShapeM) return null
  const [lng, lat] = landmarkCenter(l)
  const metersPerLng = 111320 * Math.cos((lat * Math.PI) / 180)
  const [length, width] = l.miniShapeM
  const r = (l.bearingDeg * Math.PI) / 180
  // 긴 변 방향(동쪽·북쪽 성분)과 그 오른쪽 수직 방향
  const along: [number, number] = [Math.sin(r), Math.cos(r)]
  const across: [number, number] = [Math.cos(r), -Math.sin(r)]
  const corner = (a: number, b: number): [number, number] => [
    lng + ((along[0] * a * length + across[0] * b * width) / 2) / metersPerLng,
    lat + ((along[1] * a * length + across[1] * b * width) / 2) / 110574,
  ]
  const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  return [...ring, ring[0]]
}

export const hiddenFids = (landmarks: Landmark[] = LANDMARKS): number[] => landmarks.flatMap(l => l.hideFids)

// 줌에 따른 나타남 정도 0 → 1
export function landmarkFade(zoom: number, range: [number, number] = LANDMARK_FADE_ZOOM): number {
  return Math.min(1, Math.max(0, (zoom - range[0]) / (range[1] - range[0])))
}
