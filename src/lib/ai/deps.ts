// AI 파트가 다른 역할(`src/lib/trips`·`src/lib/places`·`src/lib/geo`·`src/lib/auth`)의 함수를 부르는 지점.
// 이름·인자는 역할 문서(account-trip.md, data-geo.md)에서 그대로 왔다.
// 실제 실행은 real-deps.ts가 실제 함수로 채우고, 테스트는 같은 모양의 개발용 가짜(dev-deps.ts)를 쓴다.
import 'server-only'
import type { Budget, Opinion, PlaceDetail, PlaceSummary, Transport, Traveler, TripVersion, Coord } from '@/lib/contracts'
import type { StartMode, InterviewState, AiFallback, ApiErrorCode } from '@/lib/contracts'
import type { Stop, Leg, LegRequest } from '@/lib/contracts'
import type { callJson } from './client'

// 김경선 trips.ts의 trip 행 가운데 AI가 필요한 칸
export type AiTripInfo = { id: string; groupId: string; startMode: StartMode }
export type TripContext = { trip: AiTripInfo; travelers: Traveler[]; versions: TripVersion[] }
export type SessionUser = { userId: string; userName: string }

// 김경선 createVersion(tripId, {...})의 입력 모양 — AI가 만든 버전이라 madeBy는 항상 'ai'
export type CreateVersionInput = {
  parentId: string | null
  stops: Stop[]
  madeBy: 'ai'
  madeByUserId?: string // 다시 짜기를 누른 사람 (버전을 만든 사람 표시용)
  note?: string
  appliedOpinionIds?: string[]
}

// 이동주 searchCandidates({ styles, budget, transport, avoidStairs, limit })의 입력 모양
export type CandidateQuery = {
  styles: string[]
  budget?: Budget
  transport: Transport
  avoidStairs: boolean
  limit: number
}

// 김경선 trip_interviews 테이블 — AI는 테이블을 직접 쓰지 않고 이 연결 지점으로만 저장·조회한다
export interface InterviewStore {
  get(tripId: string): Promise<InterviewState | null>
  save(tripId: string, state: InterviewState): Promise<void>
}

export interface AiDeps {
  // 김경선 trips — 로그인 안 하면 401, 그 여행 그룹의 구성원이 아니면 403(없는 여행도 403)을 HttpError로 던진다.
  // 던지는 쪽은 src/lib/auth/http.ts의 HttpError이고, 이 폴더의 HttpError가 그 자식이라 handle이 둘 다 잡는다.
  requireTripMember(request: Request, tripId: string): Promise<SessionUser>
  getTripContext(tripId: string): Promise<TripContext>
  getOpinions(versionId: string): Promise<Opinion[]>
  createVersion(tripId: string, input: CreateVersionInput): Promise<TripVersion>
  // 김경선 — 인터뷰가 채운 여행자를 저장한다
  saveTravelers(tripId: string, travelers: Traveler[]): Promise<void>
  // 이동주 places·geo
  searchCandidates(q: CandidateQuery): Promise<PlaceSummary[]>
  matchPlaceByName(name: string): Promise<PlaceSummary | null>
  // 이동주 TMAP POI — 붙여넣은 일정의 이름으로 좌표만 찾을 때
  searchPoi(name: string): Promise<{ name: string; coord: Coord } | null>
  getPlaceDetails(ids: string[]): Promise<PlaceDetail[]>
  getLegs(requests: LegRequest[]): Promise<Leg[]>
  interviews: InterviewStore
  // 모든 AI 호출은 실제 client.ts의 callJson으로만 한다 — 테스트에서 가짜로 바꿔 끼우는 지점
  callJson: typeof callJson
}

// ApiErrorCode·AiFallback는 http.ts(HttpError)에서 쓴다 — 이 파일에 타입 재수출을 두는 이유는
// 각 API 파일이 contracts와 http 두 군데에서 따로 import하는 실수를 막기 위해서다.
export type { ApiErrorCode, AiFallback }
