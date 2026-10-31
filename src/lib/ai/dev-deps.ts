// 테스트 전용 메모리 가짜 연결 지점. 실제 실행(개발 서버·배포)은 real-deps.ts의 getAiDeps()를 쓴다.
// 라우트·서버 코드는 이 파일을 import하지 않는다 — x-dev-user 헤더로 로그인 없이 들어오는 길을 실제 실행에 두지 않으려는 것이다.
// 개발용 데이터는 전부 source '개발용 가짜 데이터'·'개발용 추정', confidence 'C'로 표시해 진짜 데이터와 섞이지 않게 한다.
import 'server-only'
import type {
  Coord,
  InterviewState,
  Leg,
  LegRequest,
  Opinion,
  PlaceDetail,
  PlaceSummary,
  Traveler,
  TripVersion,
} from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import type { AiDeps, CandidateQuery, CreateVersionInput, InterviewStore, SessionUser, TripContext } from './deps'
import { callJson } from './client'
import { HttpError } from './http'

const DEV_CHECKED_AT = '2026-10-30' // 가짜 데이터의 확인 날짜 — 날짜가 바뀌어도 같은 값으로 돌게 고정했다

// 하버사인 거리. 좌표는 [경도, 위도].
function haversineM(a: Coord, b: Coord): number {
  const radiusM = 6371000
  const rad = Math.PI / 180
  const latA = a[1] * rad
  const latB = b[1] * rad
  const dLat = latB - latA
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2
  return 2 * radiusM * Math.asin(Math.sqrt(h))
}

const HANBAT_COORD: Coord = [127.3745, 36.3498]
const SCIENCE_COORD: Coord = [127.2546, 36.3926]
const MUSEUM_COORD: Coord = [127.3850, 36.3315]
const DEV_POI_COORD: Coord = [127.383, 36.35] // DB에 없는 이름의 개발용 POI 자리

// 구간 path는 최소 두 점 — 끝점 좌표를 잇는 직선으로 둔다.
const straightPath = (from: Coord, to: Coord): Coord[] => [from, to]

// 장소 세 곳. 노드는 출발 지점·입구·볼거리·(쉼터·출구)만, 구간은 간단히 2~3개다.
const hanbat: PlaceDetail = {
  id: 'hanbat',
  name: '한밭수목원',
  category: '수목원',
  styles: ['자연·산책', '휴식·힐링'],
  coord: HANBAT_COORD,
  visitMin: 90,
  seated: false,
  indoor: false,
  source: '개발용 가짜 데이터',
  checkedAt: DEV_CHECKED_AT,
  confidence: 'C',
  nodes: [
    { id: 'p', placeId: 'hanbat', kind: 'parking', name: '주차장', restType: null, coord: [127.3742, 36.3487] },
    { id: 'e', placeId: 'hanbat', kind: 'entrance', name: '입구', restType: null, coord: [127.3748, 36.3496] },
    { id: 'a', placeId: 'hanbat', kind: 'sight', name: '전망 데크', restType: null, coord: [127.3755, 36.3508] },
    { id: 'r', placeId: 'hanbat', kind: 'rest', name: '실내 쉼터', restType: 'indoor', coord: [127.3751, 36.3503] },
  ],
  segments: [
    {
      id: 'hb1',
      placeId: 'hanbat',
      fromNodeId: 'p',
      toNodeId: 'e',
      order: 0,
      distanceM: 255,
      path: straightPath(HANBAT_COORD, [127.3748, 36.3496]),
      stairsStatus: 'unknown',
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
    {
      id: 'hb2',
      placeId: 'hanbat',
      fromNodeId: 'e',
      toNodeId: 'a',
      order: 1,
      distanceM: 306,
      path: straightPath([127.3748, 36.3496], [127.3755, 36.3508]),
      stairsStatus: 'present',
      stairsCount: 24,
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
    {
      id: 'hb3',
      placeId: 'hanbat',
      fromNodeId: 'a',
      toNodeId: 'r',
      order: 2,
      distanceM: 120,
      path: straightPath([127.3755, 36.3508], [127.3751, 36.3503]),
      stairsStatus: 'unknown',
      slope: false,
      optional: true,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
  ],
}

const science: PlaceDetail = {
  id: 'science',
  name: '국립중앙과학관',
  category: '과학관',
  styles: ['과학·전시', '사진 명소'],
  coord: SCIENCE_COORD,
  visitMin: 120,
  seated: false,
  indoor: true,
  source: '개발용 가짜 데이터',
  checkedAt: DEV_CHECKED_AT,
  confidence: 'C',
  nodes: [
    { id: 'p2', placeId: 'science', kind: 'parking', name: '주차장', restType: null, coord: [127.2540, 36.3918] },
    { id: 'e2', placeId: 'science', kind: 'entrance', name: '입구', restType: null, coord: [127.2546, 36.3926] },
    { id: 'a2', placeId: 'science', kind: 'sight', name: '상설전시관', restType: null, coord: [127.2556, 36.3934] },
    { id: 'x2', placeId: 'science', kind: 'exit', name: '출구', restType: null, coord: [127.2560, 36.3926] },
  ],
  segments: [
    {
      id: 'sc1',
      placeId: 'science',
      fromNodeId: 'p2',
      toNodeId: 'e2',
      order: 0,
      distanceM: 200,
      path: straightPath([127.254, 36.3918], [127.2546, 36.3926]),
      stairsStatus: 'unknown',
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
    {
      id: 'sc2',
      placeId: 'science',
      fromNodeId: 'e2',
      toNodeId: 'a2',
      order: 1,
      distanceM: 300,
      path: straightPath([127.2546, 36.3926], [127.2556, 36.3934]),
      stairsStatus: 'unknown',
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
    {
      id: 'sc3',
      placeId: 'science',
      fromNodeId: 'a2',
      toNodeId: 'x2',
      order: 2,
      distanceM: 100,
      path: straightPath([127.2556, 36.3934], [127.256, 36.3926]),
      stairsStatus: 'unknown',
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
  ],
}

const museum: PlaceDetail = {
  id: 'museum',
  name: '대전시립미술관',
  category: '미술관',
  styles: ['문화·역사', '사진 명소'],
  coord: MUSEUM_COORD,
  visitMin: 60,
  seated: false,
  indoor: true,
  source: '개발용 가짜 데이터',
  checkedAt: DEV_CHECKED_AT,
  confidence: 'C',
  nodes: [
    { id: 'p3', placeId: 'museum', kind: 'parking', name: '주차장', restType: null, coord: [127.3844, 36.3308] },
    { id: 'e3', placeId: 'museum', kind: 'entrance', name: '입구', restType: null, coord: [127.385, 36.3315] },
    { id: 'a3', placeId: 'museum', kind: 'sight', name: '전시실', restType: null, coord: [127.3856, 36.3322] },
  ],
  segments: [
    {
      id: 'ms1',
      placeId: 'museum',
      fromNodeId: 'p3',
      toNodeId: 'e3',
      order: 0,
      distanceM: 150,
      path: straightPath([127.3844, 36.3308], [127.385, 36.3315]),
      stairsStatus: 'unknown',
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
    {
      id: 'ms2',
      placeId: 'museum',
      fromNodeId: 'e3',
      toNodeId: 'a3',
      order: 1,
      distanceM: 200,
      path: straightPath([127.385, 36.3315], [127.3856, 36.3322]),
      stairsStatus: 'unknown',
      slope: false,
      optional: false,
      source: '개발용 가짜 데이터',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    },
  ],
}

const DEV_PLACES: PlaceDetail[] = [hanbat, science, museum]
const DEV_DETAILS: Record<string, PlaceDetail> = Object.fromEntries(DEV_PLACES.map(place => [place.id, place]))

// 상세에서 지점·구간을 뺀 요약 (PlaceDetail이 PlaceSummary를 확장하므로 칸을 빼면 그대로 요약이 된다).
function toSummary(detail: PlaceDetail): PlaceSummary {
  return {
    id: detail.id,
    name: detail.name,
    category: detail.category,
    styles: detail.styles,
    coord: detail.coord,
    visitMin: detail.visitMin,
    seated: detail.seated,
    indoor: detail.indoor,
    address: '대전 어딘가 (개발용 가짜 주소)',
    source: detail.source,
    checkedAt: detail.checkedAt,
    confidence: detail.confidence,
  }
}

// 인터뷰가 채우기 전 여행자: 엄마(부모님, 72세, u-mom 계정)와 나(32세).
const DEV_TRAVELERS: Traveler[] = [
  {
    id: 't1',
    label: '엄마',
    userId: 'u-mom',
    age: 72,
    sex: 'female',
    pace: 'normal',
    mobilityAid: false,
    isParent: true,
    condition: {},
    filledBySelf: false,
  },
  {
    id: 't2',
    label: '나',
    age: 32,
    pace: 'normal',
    mobilityAid: false,
    isParent: false,
    condition: {},
    filledBySelf: true,
  },
]

type DevTrip = {
  trip: { id: string; groupId: string; startMode: 'scratch' }
  travelers: Traveler[]
  versions: TripVersion[]
  opinions: Opinion[]
  nextNumber: number
}

function memoryInterviewStore(): InterviewStore {
  const states = new Map<string, InterviewState>()
  return {
    async get(tripId) {
      return states.get(tripId) ?? null
    },
    async save(tripId, state) {
      states.set(tripId, state)
    },
  }
}

// 개발용 경로: 두 점 사이 하버사인 거리 × 1.3(우회 계수)으로 추정한다. 실제는 이동주의 TMAP getLegs로 바뀐다.
// 탈것 속도는 간단히 480 m/분(약 29 km/h)으로, 택시 요금은 3,800원 + 400원/1 km로 추정한다 — 개발용일 뿐이다.
function estimateLegs(requests: LegRequest[]): Leg[] {
  return requests.map(request => {
    const distanceM = Math.round(haversineM(request.from.coord, request.to.coord) * 1.3)
    const leg: Leg = {
      key: legKey(request),
      mode: request.mode,
      distanceM,
      path: [request.from.coord, request.to.coord],
      stairsStatus: 'unknown',
      source: '개발용 추정',
      checkedAt: DEV_CHECKED_AT,
      confidence: 'C',
    }
    if (request.mode !== 'walk') {
      return {
        ...leg,
        durationMin: Math.max(1, Math.ceil(distanceM / 480)),
        ...(request.mode === 'taxi' ? { fareKrw: Math.round(3800 + distanceM * 0.4) } : {}),
      }
    }
    return leg
  })
}

export function createDevDeps(seed?: { opinions?: Opinion[] }): AiDeps {
  // 한 번 더 막는다: 가짜 로그인(x-dev-user)이 배포 환경에 올라가면 누구나 들어올 수 있다.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('개발용 가짜 연결(dev-deps)은 production에서 쓸 수 없어요')
  }
  const trips = new Map<string, DevTrip>([
    [
      'trip-dev',
      {
        trip: { id: 'trip-dev', groupId: 'g-dev', startMode: 'scratch' },
        travelers: DEV_TRAVELERS.map(t => ({ ...t })),
        versions: [],
        opinions: seed?.opinions?.map(opinion => ({ ...opinion })) ?? [],
        nextNumber: 1,
      },
    ],
  ])
  const interviews = memoryInterviewStore()

  const requireTripMember = async (request: Request, tripId: string): Promise<SessionUser> => {
    // 가짜 로그인: 개발용 헤더 x-dev-user에 아이디가 있으면 그 사용자로 본다. 실제는 real-deps.ts의 김경선 requireTripMember.
    const userId = request.headers.get('x-dev-user')
    if (!userId) throw new HttpError(401, 'unauthorized', '로그인이 필요해요')
    if (tripId !== 'trip-dev') throw new HttpError(403, 'forbidden', '이 여행의 구성원이 아니에요')
    return { userId, userName: userId }
  }

  const createVersion = async (tripId: string, input: CreateVersionInput): Promise<TripVersion> => {
    const devTrip = trips.get(tripId)
    if (!devTrip) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')
    const version: TripVersion = {
      id: `v${devTrip.nextNumber}`,
      tripId,
      number: devTrip.nextNumber,
      parentId: input.parentId,
      madeBy: input.madeBy,
      madeByUserId: null,
      stops: input.stops.map(stop => ({ ...stop })),
      summary: null, // 개발용은 판정 요약을 저장하지 않는다 (실제 createVersion은 김경선이 계산해 저장)
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    }
    devTrip.nextNumber += 1
    devTrip.versions.push(version)
    return version
  }

  const deps: AiDeps = {
    requireTripMember,
    async getTripContext(tripId) {
      const devTrip = trips.get(tripId)
      if (!devTrip) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')
      const context: TripContext = {
        trip: { ...devTrip.trip },
        travelers: devTrip.travelers.map(t => ({ ...t })),
        versions: devTrip.versions.map(version => ({ ...version })),
      }
      return context
    },
    async getOpinions(versionId) {
      const all = [...trips.values()].flatMap(devTrip => devTrip.opinions)
      return all.filter(opinion => opinion.versionId === versionId)
    },
    createVersion,
    async saveTravelers(tripId, travelers) {
      const devTrip = trips.get(tripId)
      if (!devTrip) throw new HttpError(404, 'not_found', '여행을 찾을 수 없어요')
      devTrip.travelers = travelers.map(t => ({ ...t }))
    },
    async searchCandidates(q: CandidateQuery) {
      // 개발용은 스타일·예산 조건을 걸러 보지 않는다 — 실제 searchCandidates가 붙으면 바뀐다.
      const summaries = DEV_PLACES.map(toSummary)
      return summaries.slice(0, Math.max(0, q.limit))
    },
    async matchPlaceByName(name) {
      const trimmed = name.trim()
      // 별칭 없이 간단히: 같은 이름이거나 장소 이름이 입력에 포함되면 맞춘다.
      const found =
        DEV_PLACES.find(place => place.name === trimmed) ??
        DEV_PLACES.find(place => trimmed.includes(place.name))
      return found ? toSummary(found) : null
    },
    async searchPoi(name) {
      // 개발용은 어느 이름이든 같은 자리(대전 중심)로 찾았다고 본다.
      return { name: name.trim(), coord: DEV_POI_COORD }
    },
    async getPlaceDetails(ids) {
      return ids.map(id => DEV_DETAILS[id]).filter((detail): detail is PlaceDetail => detail !== undefined)
    },
    getLegs: async requests => estimateLegs(requests),
    interviews,
    callJson, // 실제 호출 그대로 — 키가 없으면 client.ts가 AiCallError를 던진다
  }
  return deps
}
