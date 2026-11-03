// 화면이 부르는 API 전부. 요청·응답 타입은 src/lib/contracts 에서 가져온다.
// 같은 모양을 실제 서버(real.ts)와 목업(src/mocks)이 각각 구현하고, NEXT_PUBLIC_USE_MOCKS=1 이면 목업을 쓴다.
import type {
  AcceptInviteResponse,
  Budget,
  ChatListResponse,
  ChatMessage,
  CreateGroupRequest,
  CreateTripRequest,
  DayFeedbackInput,
  DayFeedbackItem,
  DayFeedbackListResponse,
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
  PlaceKind,
  PlanResponse,
  ReviseRequest,
  ReviseResponse,
  SaveVersionRequest,
  ShareTextResponse,
  Traveler,
  TravelerHealth,
  TravelerHealthInput,
  Trip,
  TripDetail,
  TripListItem,
  TripVersion,
  UpdateTripRequest,
  User,
  TripWeatherResponse,
} from '@/lib/contracts'

export type { Budget }

export type SignUpInput = { name: string; email: string; password: string }
export type SignInInput = { email: string; password: string }
export type PlaceQuery = { q?: string; styles?: string[]; kind?: PlaceKind; limit?: number }

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
    // relation(엄마·아빠·딸 …)은 선택. 안 주면 본문을 비워 보내고, 서버가 앞뒤 공백을 지워 1~20자만 받는다
    accept(token: string, relation?: string | null): Promise<AcceptInviteResponse>
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
  // 건강 정보(병·약 종류, 보이는 범위, 동의). 서버가 보는 사람에 맞춰 걸러서 내려주고, 고칠 수 있는 사람도 서버가 검사한다
  health: {
    // 내가 볼 수 있는 항목만 온다. "본인만"으로 둔 다른 가족의 항목은 배열에 아예 없다
    list(tripId: string): Promise<TravelerHealth[]>
    // 동의(consent: true)가 없으면 400. 계정이 연결된 여행자는 본인만, 계정 없는 여행자는 처음 입력한 사람만 고칠 수 있다 (아니면 403)
    put(tripId: string, travelerId: string, input: TravelerHealthInput): Promise<TravelerHealth>
    // 지우기 = 동의 철회. 바로 삭제하고 본문 없이 끝난다 (204). 고칠 수 있는 사람만 (아니면 403)
    remove(tripId: string, travelerId: string): Promise<void>
  }
  // 여행 날짜별 날씨 예보 (기상청, 대전 기준). 예보를 못 받은 날은 status가 unavailable로 온다
  weather: {
    get(tripId: string): Promise<TripWeatherResponse>
  }
  opinions: {
    list(versionId: string): Promise<Opinion[]>
    add(versionId: string, input: OpinionInput): Promise<Opinion>
    remove(opinionId: string): Promise<void>
  }
  feedback: {
    list(tripId: string): Promise<DayFeedbackListResponse>
    // 한 사람이 그날에 하나만 남긴다. 다시 보내면 덮어쓴다
    save(tripId: string, input: DayFeedbackInput): Promise<DayFeedbackItem>
  }
  chat: {
    // after 시각 이후(같은 시각 포함)의 글. 없으면 최근 글. 이미 받은 글이 또 올 수 있어 id로 거른다
    list(tripId: string, after?: string): Promise<ChatListResponse>
    post(tripId: string, text: string): Promise<ChatMessage>
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
