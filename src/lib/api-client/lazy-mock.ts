// 목업 API 를 처음 부를 때 불러오는 껍데기. NEXT_PUBLIC_USE_MOCKS=1 인 빌드에서만 src/mocks 를 번들에 넣는다.
// 정적 import 로 두면 끈 빌드의 클라이언트 번들에도 목업 데이터와 연습용 비밀번호가 들어간다.
// Api 의 모든 메서드를 하나씩 적어 둔다 — 메서드가 늘면 타입 검사가 여기서 알려 준다.
import type { Api } from './types'

let loading: Promise<Api> | null = null

async function loadMockApi(): Promise<Api> {
  // 조건을 이 자리에 그대로 써야 빌드가 값을 박아 넣고 import() 를 통째로 지운다 (변수에 담으면 접히지 않을 수 있다)
  if (process.env.NEXT_PUBLIC_USE_MOCKS === '1') {
    const { mockApi } = await import('@/mocks/mock-api')
    return mockApi
  }
  throw new Error('목업은 NEXT_PUBLIC_USE_MOCKS=1 일 때만 쓸 수 있어요')
}

// 한 번 불러온 뒤에는 같은 것을 쓰고, 불러오지 못했으면 다음 호출에서 다시 시도한다
function mock(): Promise<Api> {
  loading ??= loadMockApi().catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

export const lazyMockApi: Api = {
  auth: {
    getSession: async () => (await mock()).auth.getSession(),
    signUp: async input => (await mock()).auth.signUp(input),
    signIn: async input => (await mock()).auth.signIn(input),
    signOut: async () => (await mock()).auth.signOut(),
  },
  groups: {
    list: async () => (await mock()).groups.list(),
    create: async input => (await mock()).groups.create(input),
    get: async groupId => (await mock()).groups.get(groupId),
    createInvite: async groupId => (await mock()).groups.createInvite(groupId),
    removeMember: async (groupId, userId) => (await mock()).groups.removeMember(groupId, userId),
    listTrips: async groupId => (await mock()).groups.listTrips(groupId),
  },
  invites: {
    preview: async token => (await mock()).invites.preview(token),
    accept: async token => (await mock()).invites.accept(token),
  },
  trips: {
    create: async input => (await mock()).trips.create(input),
    get: async tripId => (await mock()).trips.get(tripId),
    update: async (tripId, patch) => (await mock()).trips.update(tripId, patch),
    putTravelers: async (tripId, travelers) => (await mock()).trips.putTravelers(tripId, travelers),
    patchTraveler: async (tripId, travelerId, patch) => (await mock()).trips.patchTraveler(tripId, travelerId, patch),
    getVersion: async (tripId, versionId) => (await mock()).trips.getVersion(tripId, versionId),
    saveVersion: async (tripId, input) => (await mock()).trips.saveVersion(tripId, input),
    confirm: async (tripId, versionId) => (await mock()).trips.confirm(tripId, versionId),
    unconfirm: async tripId => (await mock()).trips.unconfirm(tripId),
    shareText: async tripId => (await mock()).trips.shareText(tripId),
  },
  opinions: {
    list: async versionId => (await mock()).opinions.list(versionId),
    add: async (versionId, input) => (await mock()).opinions.add(versionId, input),
    remove: async opinionId => (await mock()).opinions.remove(opinionId),
  },
  places: {
    list: async query => (await mock()).places.list(query),
    get: async placeId => (await mock()).places.get(placeId),
    details: async ids => (await mock()).places.details(ids),
  },
  legs: {
    get: async requests => (await mock()).legs.get(requests),
  },
  ai: {
    interview: async input => (await mock()).ai.interview(input),
    parseSchedule: async input => (await mock()).ai.parseSchedule(input),
    generate: async input => (await mock()).ai.generate(input),
    revise: async input => (await mock()).ai.revise(input),
    explain: async input => (await mock()).ai.explain(input),
  },
}
