// 목업 장소 데이터 (한밭수목원, 국립중앙과학관, 대전시립미술관 + 직접 고치기에서 고를 후보 2곳).
// 좌표는 시안(Bopok)의 임시 좌표를 이어받은 값이며 실제 조사 값이 아니다. 실제 데이터는 이동주의 장소 DB가 준다.
import { PlaceSummarySchema, type Coord, type PlaceDetail, type PlaceNode, type PlaceNodeKind, type PlaceSegment, type PlaceSummary } from '@/lib/contracts'
import { pathLengthM } from './geo-util'

const SOURCE = '목업 데이터(임시 좌표)'
const CHECKED_AT = '2026-10'

function node(placeId: string, id: string, kind: PlaceNodeKind, name: string, coord: Coord, restType: PlaceNode['restType'] = null): PlaceNode {
  return { id, placeId, kind, name, restType, coord }
}

type SegmentArgs = {
  placeId: string
  id: string
  from: string
  to: string
  order: number
  path: Coord[]
  stairs?: number | 'unknown'
  slope?: boolean
  optional?: boolean
  detourOf?: string
  confidence?: PlaceSegment['confidence']
}

// 거리는 경로 길이에서 계산해 선과 숫자가 어긋나지 않게 한다. stairs: 숫자 = 계단 칸 수, 'unknown' = 기록 없음, 생략 = 사람이 확인한 계단 없음
function segment(a: SegmentArgs): PlaceSegment {
  const stairsStatus: PlaceSegment['stairsStatus'] = a.stairs === undefined ? 'confirmed_none' : a.stairs === 'unknown' ? 'unknown' : 'present'
  return {
    id: a.id,
    placeId: a.placeId,
    fromNodeId: a.from,
    toNodeId: a.to,
    order: a.order,
    distanceM: pathLengthM(a.path),
    path: a.path,
    stairsStatus,
    stairsCount: typeof a.stairs === 'number' ? a.stairs : undefined,
    slope: a.slope ?? false,
    optional: a.optional ?? false,
    detourOf: a.detourOf,
    source: SOURCE,
    checkedAt: CHECKED_AT,
    confidence: a.confidence ?? 'B',
  }
}

// ───────── 한밭수목원 ─────────
const HB = 'hanbat'
const hbP: Coord = [127.3866, 36.369]
const hbS: Coord = [127.3872, 36.3686]
const hbIn: Coord = [127.3856, 36.3684]
const hbRest: Coord = [127.3846, 36.3688]
const hbDeck: Coord = [127.3836, 36.368]
const hbGarden: Coord = [127.3848, 36.3672]
const hbOut: Coord = [127.3853, 36.3669]

export const hanbat: PlaceDetail = {
  id: HB,
  name: '한밭수목원',
  category: '공원',
  styles: ['자연·산책', '휴식·힐링', '사진 명소'],
  coord: hbIn,
  visitMin: 60,
  seated: false,
  indoor: false,
  address: '대전 서구 둔산대로 169',
  phone: '042-270-8452',
  homepage: 'https://www.daejeon.go.kr/gar',
  source: SOURCE,
  checkedAt: CHECKED_AT,
  confidence: 'B',
  nodes: [
    node(HB, 'hb-p', 'parking', '주차장', hbP),
    node(HB, 'hb-s', 'stop', '정류장', hbS),
    node(HB, 'hb-in', 'entrance', '입구', hbIn),
    node(HB, 'hb-rest', 'rest', '실내 쉼터', hbRest, 'indoor'),
    node(HB, 'hb-deck', 'sight', '전망 데크', hbDeck),
    node(HB, 'hb-garden', 'sight', '정원', hbGarden),
    node(HB, 'hb-out', 'exit', '출구', hbOut),
  ],
  segments: [
    segment({ placeId: HB, id: 'hb1', from: 'hb-p', to: 'hb-in', order: 0, path: [hbP, [127.3861, 36.3687], hbIn] }),
    segment({ placeId: HB, id: 'hb1b', from: 'hb-s', to: 'hb-in', order: 0, path: [hbS, [127.3864, 36.3685], hbIn] }),
    segment({ placeId: HB, id: 'hb2', from: 'hb-in', to: 'hb-rest', order: 1, path: [hbIn, [127.3851, 36.3687], hbRest], confidence: 'A' }),
    segment({ placeId: HB, id: 'hb3', from: 'hb-rest', to: 'hb-deck', order: 2, path: [hbRest, [127.3841, 36.3684], hbDeck], stairs: 24, slope: true, confidence: 'A' }),
    segment({
      placeId: HB, id: 'hb3r', from: 'hb-rest', to: 'hb-deck', order: 2, detourOf: 'hb3', confidence: 'A',
      path: [hbRest, [127.3842, 36.3692], [127.3835, 36.3688], [127.3832, 36.3683], hbDeck],
    }),
    segment({ placeId: HB, id: 'hb4', from: 'hb-deck', to: 'hb-garden', order: 3, path: [hbDeck, [127.3841, 36.3675], hbGarden], stairs: 'unknown', confidence: 'C' }),
    segment({ placeId: HB, id: 'hb5', from: 'hb-garden', to: 'hb-out', order: 4, path: [hbGarden, hbOut], optional: true }),
  ],
}

// ───────── 국립중앙과학관 ─────────
const SC = 'science'
const scP: Coord = [127.3745, 36.3763]
const scIn: Coord = [127.3758, 36.377]
const scLobby: Coord = [127.3764, 36.3772]
const scHall: Coord = [127.377, 36.3774]
const scOut: Coord = [127.3774, 36.3776]

export const science: PlaceDetail = {
  id: SC,
  name: '국립중앙과학관',
  category: '과학관',
  styles: ['과학·전시', '문화·역사'],
  coord: scHall,
  visitMin: 90,
  seated: false,
  indoor: true,
  address: '대전 유성구 대덕대로 481',
  phone: '042-601-7979',
  homepage: 'https://www.science.go.kr',
  source: SOURCE,
  checkedAt: CHECKED_AT,
  confidence: 'B',
  nodes: [
    node(SC, 'sc-p', 'parking', '주차장', scP),
    node(SC, 'sc-in', 'entrance', '입구', scIn),
    node(SC, 'sc-rest', 'rest', '로비 쉼터', scLobby, 'indoor'),
    node(SC, 'sc-hall', 'sight', '전시관', scHall),
    node(SC, 'sc-out', 'exit', '출구', scOut),
  ],
  segments: [
    segment({ placeId: SC, id: 'sc1', from: 'sc-p', to: 'sc-in', order: 0, path: [scP, [127.3751, 36.3767], scIn], confidence: 'A' }),
    segment({ placeId: SC, id: 'sc2', from: 'sc-in', to: 'sc-rest', order: 1, path: [scIn, scLobby], confidence: 'A' }),
    segment({ placeId: SC, id: 'sc3', from: 'sc-rest', to: 'sc-hall', order: 2, path: [scLobby, [127.3767, 36.3773], scHall], confidence: 'A' }),
    segment({ placeId: SC, id: 'sc4', from: 'sc-hall', to: 'sc-out', order: 3, path: [scHall, scOut], optional: true }),
  ],
}

// ───────── 대전시립미술관 ─────────
const AM = 'art'
const amStop: Coord = [127.3862, 36.3744]
const amIn: Coord = [127.3868, 36.3749]
const amHall: Coord = [127.3872, 36.3753]
const amOut: Coord = [127.3875, 36.3756]

export const art: PlaceDetail = {
  id: AM,
  name: '대전시립미술관',
  category: '미술관',
  styles: ['문화·역사', '휴식·힐링', '사진 명소'],
  coord: amHall,
  visitMin: 60,
  seated: false,
  indoor: true,
  address: '대전 서구 둔산대로 155',
  phone: '042-270-7370',
  homepage: 'https://dma.daejeon.go.kr',
  source: SOURCE,
  checkedAt: CHECKED_AT,
  confidence: 'B',
  nodes: [
    node(AM, 'am-stop', 'stop', '정류장', amStop),
    node(AM, 'am-in', 'entrance', '입구', amIn),
    node(AM, 'am-hall', 'sight', '전시실', amHall),
    node(AM, 'am-out', 'exit', '출구', amOut),
  ],
  segments: [
    segment({ placeId: AM, id: 'am1', from: 'am-stop', to: 'am-in', order: 0, path: [amStop, [127.3865, 36.3746], amIn], confidence: 'A' }),
    segment({ placeId: AM, id: 'am2', from: 'am-in', to: 'am-hall', order: 1, path: [amIn, [127.387, 36.3751], amHall], confidence: 'A' }),
    segment({ placeId: AM, id: 'am3', from: 'am-hall', to: 'am-out', order: 2, path: [amHall, amOut], optional: true }),
  ],
}

// ───────── 직접 고치기에서 고를 수 있는 다른 장소 ─────────
const LE = 'leeungno'
const leP: Coord = [127.3905, 36.3728]
const leIn: Coord = [127.391, 36.3733]
const leHall: Coord = [127.3915, 36.3738]

export const leeungno: PlaceDetail = {
  id: LE,
  name: '이응노미술관',
  category: '미술관',
  styles: ['문화·역사', '휴식·힐링'],
  coord: leHall,
  visitMin: 60,
  seated: false,
  indoor: true,
  address: '대전 서구 만년로 38',
  source: SOURCE,
  checkedAt: CHECKED_AT,
  confidence: 'C',
  nodes: [
    node(LE, 'le-p', 'parking', '주차장', leP),
    node(LE, 'le-in', 'entrance', '입구', leIn),
    node(LE, 'le-hall', 'sight', '전시관', leHall),
  ],
  segments: [
    segment({ placeId: LE, id: 'le1', from: 'le-p', to: 'le-in', order: 0, path: [leP, leIn], confidence: 'C' }),
    segment({ placeId: LE, id: 'le2', from: 'le-in', to: 'le-hall', order: 1, path: [leIn, [127.3912, 36.3735], leHall], stairs: 12, confidence: 'C' }),
  ],
}

const HV = 'hanbit'
const hvP: Coord = [127.3895, 36.3735]
const hvIn: Coord = [127.3888, 36.3743]
const hvPlaza: Coord = [127.388, 36.375]
const hvTower: Coord = [127.3885, 36.376]

export const hanbit: PlaceDetail = {
  id: HV,
  name: '엑스포과학공원 한빛탑',
  category: '공원',
  styles: ['관광·명소', '사진 명소', '자연·산책'],
  coord: hvTower,
  visitMin: 45,
  seated: false,
  indoor: false,
  address: '대전 유성구 대덕대로 480',
  source: SOURCE,
  checkedAt: CHECKED_AT,
  confidence: 'C',
  nodes: [
    node(HV, 'hv-p', 'parking', '주차장', hvP),
    node(HV, 'hv-in', 'entrance', '입구', hvIn),
    node(HV, 'hv-plaza', 'rest', '광장 쉼터', hvPlaza, 'outdoor'),
    node(HV, 'hv-tower', 'sight', '한빛탑', hvTower),
  ],
  segments: [
    segment({ placeId: HV, id: 'hv1', from: 'hv-p', to: 'hv-in', order: 0, path: [hvP, hvIn], confidence: 'C' }),
    segment({ placeId: HV, id: 'hv2', from: 'hv-in', to: 'hv-plaza', order: 1, path: [hvIn, hvPlaza], confidence: 'C' }),
    segment({ placeId: HV, id: 'hv3', from: 'hv-plaza', to: 'hv-tower', order: 2, path: [hvPlaza, [127.3883, 36.3755], hvTower], stairs: 'unknown', confidence: 'C' }),
  ],
}

// ───────── 점심 식당 (앉아서 머무는 곳 → 연속 걷기가 끊긴다) ─────────
const LU = 'lunch-dorong'
const luP: Coord = [127.3787, 36.3743]
const luIn: Coord = [127.379, 36.3745]

export const lunchDorong: PlaceDetail = {
  id: LU,
  name: '도룡동 한식당',
  category: '음식점',
  styles: ['맛집·음식'],
  coord: luIn,
  visitMin: 60,
  seated: true,
  indoor: true,
  address: '대전 유성구 도룡동',
  source: SOURCE,
  checkedAt: CHECKED_AT,
  confidence: 'C',
  nodes: [node(LU, 'lu-p', 'parking', '주차장', luP), node(LU, 'lu-in', 'entrance', '입구', luIn)],
  segments: [segment({ placeId: LU, id: 'lu1', from: 'lu-p', to: 'lu-in', order: 0, path: [luP, luIn], confidence: 'C' })],
}

export const mockPlaceDetails: PlaceDetail[] = [hanbat, science, art, leeungno, hanbit, lunchDorong]
export const mockPlaces: Record<string, PlaceDetail> = Object.fromEntries(mockPlaceDetails.map(place => [place.id, place]))

// zod 객체는 모르는 칸(nodes, segments)을 버리므로 요약이 된다
export const toSummary = (place: PlaceDetail): PlaceSummary => PlaceSummarySchema.parse(place)
