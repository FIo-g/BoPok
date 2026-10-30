// 테스트에서만 쓰는 장소 데이터. 노션 4-2 예시(한밭수목원)를 그대로 옮겼다.
// `.test.ts`가 아니라서 purity.test.ts의 검사 대상이다 → React·DB·fetch·환경 변수를 쓰지 않는다.
import type { Coord, PlaceDetail, PlaceNode, PlaceNodeKind, PlaceSegment } from '@/lib/contracts'

// 나이를 모르는 여행자 속도(설계 7.1). 51 m/분이라 테스트 숫자가 딱 떨어진다.
export const SPEED_MPS = 0.85

function node(
  placeId: string,
  id: string,
  kind: PlaceNodeKind,
  name: string,
  coord: Coord,
  restType: 'indoor' | 'outdoor' | null = null,
): PlaceNode {
  return { id, placeId, kind, name, restType, coord }
}

function segment(args: {
  placeId: string
  id: string
  fromNodeId: string
  toNodeId: string
  order: number
  distanceM: number
  fromCoord: Coord
  toCoord: Coord
  stairsStatus?: PlaceSegment['stairsStatus']
  stairsCount?: number
  slope?: boolean
  optional?: boolean
  detourOf?: string
}): PlaceSegment {
  return {
    id: args.id,
    placeId: args.placeId,
    fromNodeId: args.fromNodeId,
    toNodeId: args.toNodeId,
    order: args.order,
    distanceM: args.distanceM,
    path: [args.fromCoord, args.toCoord],
    stairsStatus: args.stairsStatus ?? 'confirmed_none',
    stairsCount: args.stairsCount,
    slope: args.slope ?? false,
    optional: args.optional ?? false,
    detourOf: args.detourOf,
    source: '테스트 픽스처',
    checkedAt: '2026-10',
    confidence: 'C',
  }
}

const HANBAT = 'hanbat'
const hP: Coord = [127.384, 36.35]
const hS: Coord = [127.3842, 36.3502]
const hE: Coord = [127.3845, 36.3504]
const hR: Coord = [127.3848, 36.3506]
const hA: Coord = [127.3851, 36.3508]
const hB: Coord = [127.3854, 36.351]
const hX: Coord = [127.3855, 36.3511]

export const hanbat: PlaceDetail = {
  id: HANBAT,
  name: '한밭수목원',
  category: '공원',
  styles: ['자연·산책'],
  coord: [127.3845, 36.3504],
  visitMin: 60,
  seated: false,
  indoor: false,
  source: '테스트 픽스처',
  checkedAt: '2026-10',
  confidence: 'C',
  nodes: [
    node(HANBAT, 'P', 'parking', '주차장', hP),
    node(HANBAT, 'S', 'stop', '정류장', hS),
    node(HANBAT, 'E', 'entrance', '입구', hE),
    node(HANBAT, 'R', 'rest', '실내 쉼터', hR, 'indoor'),
    node(HANBAT, 'A', 'sight', '전망 데크', hA),
    node(HANBAT, 'B', 'sight', '정원', hB),
    node(HANBAT, 'X', 'exit', '출구', hX),
  ],
  segments: [
    segment({ placeId: HANBAT, id: 's1', fromNodeId: 'P', toNodeId: 'E', order: 0, distanceM: 255, fromCoord: hP, toCoord: hE }),
    segment({ placeId: HANBAT, id: 's1b', fromNodeId: 'S', toNodeId: 'E', order: 0, distanceM: 300, fromCoord: hS, toCoord: hE }),
    segment({ placeId: HANBAT, id: 's2', fromNodeId: 'E', toNodeId: 'R', order: 1, distanceM: 306, fromCoord: hE, toCoord: hR }),
    segment({
      placeId: HANBAT,
      id: 's3',
      fromNodeId: 'R',
      toNodeId: 'A',
      order: 2,
      distanceM: 204,
      fromCoord: hR,
      toCoord: hA,
      stairsStatus: 'present',
      stairsCount: 24,
    }),
    segment({ placeId: HANBAT, id: 's3d', fromNodeId: 'R', toNodeId: 'A', order: 2, distanceM: 510, fromCoord: hR, toCoord: hA, detourOf: 's3' }),
    segment({ placeId: HANBAT, id: 's4', fromNodeId: 'A', toNodeId: 'B', order: 3, distanceM: 459, fromCoord: hA, toCoord: hB }),
    segment({ placeId: HANBAT, id: 's5', fromNodeId: 'B', toNodeId: 'X', order: 4, distanceM: 0, fromCoord: hB, toCoord: hX, optional: true }),
  ],
}

const SCIENCE = 'science'
const sP: Coord = [127.3745, 36.3735]
const sE: Coord = [127.375, 36.374]
const sA: Coord = [127.3755, 36.3745]
const sX: Coord = [127.3756, 36.3746]

export const science: PlaceDetail = {
  id: SCIENCE,
  name: '국립중앙과학관',
  category: '과학관',
  styles: ['과학·전시'],
  coord: [127.375, 36.374],
  visitMin: 90,
  seated: false,
  indoor: true,
  source: '테스트 픽스처',
  checkedAt: '2026-10',
  confidence: 'C',
  nodes: [
    node(SCIENCE, 'P2', 'parking', '주차장', sP),
    node(SCIENCE, 'E2', 'entrance', '입구', sE),
    node(SCIENCE, 'A2', 'sight', '전시관', sA),
    node(SCIENCE, 'X2', 'exit', '출구', sX),
  ],
  segments: [
    segment({ placeId: SCIENCE, id: 'c1', fromNodeId: 'P2', toNodeId: 'E2', order: 0, distanceM: 200, fromCoord: sP, toCoord: sE }),
    segment({ placeId: SCIENCE, id: 'c2', fromNodeId: 'E2', toNodeId: 'A2', order: 1, distanceM: 300, fromCoord: sE, toCoord: sA }),
    segment({ placeId: SCIENCE, id: 'c3', fromNodeId: 'A2', toNodeId: 'X2', order: 2, distanceM: 100, fromCoord: sA, toCoord: sX }),
  ],
}

// placeId → 상세. 판정 입력의 `places`와 같은 모양이다.
export const places: Record<string, PlaceDetail> = {
  [hanbat.id]: hanbat,
  [science.id]: science,
}
