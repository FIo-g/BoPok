// 화면이 부르는 API 전부. 요청·응답 타입은 src/lib/contracts 에서 가져온다.
// 같은 모양을 실제 서버(real.ts)와 목업(src/mocks)이 각각 구현하고, NEXT_PUBLIC_USE_MOCKS=1 이면 목업을 쓴다.
import type {
  AcceptInviteResponse,
  Budget,
  CreateGroupRequest,
  CreateTripRequest,
  ExplainRequest,
  ExplainResponse,
  GenerateRequest,
  Group,
  GroupDetail,
  GroupSummary,
  InterviewRequest,
  InterviewResponse,
  Invite,
  InvitePreview,
  Leg,
  LegRequest,
  Opinion,
  OpinionInput,
  ParseScheduleRequest,
  ParseScheduleResponse,
  PlaceDetail,
  PlaceSummary,
  PlanResponse,
  ReviseRequest,
  ReviseResponse,
  SaveVersionRequest,
  ShareTextResponse,
  Traveler,
  Trip,
  TripDetail,
  TripListItem,
  TripVersion,
  UpdateTripRequest,
  User,
} from '@/lib/contracts'

export type { Budget }

export type SignUpInput = { name: string; email: string; password: string }
export type SignInInput = { email: string; password: string }
export type PlaceQuery = { q?: string; styles?: string[] }

export interface Api {
  auth: {
    getSession(): Promise<User | null>
    signUp(input: SignUpInput): Promise<User>
    signIn(input: SignInInput): Promise<User>
    signOut(): Promise<void>
  }
  groups: {
    list(): Promise<GroupSummary[]>
    create(input: CreateGroupRequest): Promise<Group>
    get(groupId: string): Promise<GroupDetail>
    createInvite(groupId: string): Promise<Invite>
    removeMember(groupId: string, userId: string): Promise<void>
    listTrips(groupId: string): Promise<TripListItem[]>
  }
  invites: {
    preview(token: string): Promise<InvitePreview>
    accept(token: string): Promise<AcceptInviteResponse>
  }
  trips: {
    create(input: CreateTripRequest): Promise<Trip>
    get(tripId: string): Promise<TripDetail>
    update(tripId: string, patch: UpdateTripRequest): Promise<Trip>
    putTravelers(tripId: string, travelers: Traveler[]): Promise<Traveler[]>
    patchTraveler(tripId: string, travelerId: string, patch: Partial<Omit<Traveler, 'id'>>): Promise<Traveler>
    getVersion(tripId: string, versionId: string): Promise<TripVersion>
    saveVersion(tripId: string, input: SaveVersionRequest): Promise<TripVersion>
    confirm(tripId: string, versionId: string): Promise<Trip>
    unconfirm(tripId: string): Promise<Trip>
    shareText(tripId: string): Promise<ShareTextResponse>
  }
  opinions: {
    list(versionId: string): Promise<Opinion[]>
    add(versionId: string, input: OpinionInput): Promise<Opinion>
    remove(opinionId: string): Promise<void>
  }
  places: {
    list(query?: PlaceQuery): Promise<PlaceSummary[]>
    get(placeId: string): Promise<PlaceDetail>
    details(ids: string[]): Promise<PlaceDetail[]>
  }
  legs: {
    // 한 번에 LEGS_REQUEST_MAX 개까지. 응답은 요청 순서가 아니라 leg.key 로 짝짓고, 못 받은 경로는 응답에서 빠진다
    get(requests: LegRequest[]): Promise<Leg[]>
  }
  ai: {
    interview(input: InterviewRequest): Promise<InterviewResponse>
    parseSchedule(input: ParseScheduleRequest): Promise<ParseScheduleResponse>
    generate(input: GenerateRequest): Promise<PlanResponse>
    revise(input: ReviseRequest): Promise<ReviseResponse>
    explain(input: ExplainRequest): Promise<ExplainResponse>
  }
}
