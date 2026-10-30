// 목업 처음 데이터: 가족 그룹, 여행 2개, 버전 3개, 의견 몇 개. 로그인 계정은 DEMO_EMAIL / DEMO_PASSWORD.
import type { Group, GroupMember, Invite, Opinion, Stop, Traveler, Trip, TripVersion, User } from '@/lib/contracts'
import { judgeWithMocks } from './judge-helper'

export const DEMO_EMAIL = 'demo@bopok.test'
export const DEMO_PASSWORD = 'bopok1234'
export const DEMO_INVITE_TOKEN = 'demo-invite-token'

export type MockUser = User & { password: string }

const WHEN = '2026-10-28T09:00:00+09:00'

export const seedUsers: MockUser[] = [
  { id: 'u-me', name: '오하연', email: DEMO_EMAIL, password: DEMO_PASSWORD },
  { id: 'u-mom', name: '엄마', email: 'mom@bopok.test', password: DEMO_PASSWORD },
  { id: 'u-dad', name: '아빠', email: 'dad@bopok.test', password: DEMO_PASSWORD },
]

export const seedGroups: Group[] = [
  { id: 'g-family', name: '우리 가족', ownerId: 'u-me', createdAt: WHEN },
  { id: 'g-aunt', name: '이모네 가족', ownerId: 'u-mom', createdAt: WHEN },
]

export type MockMember = GroupMember & { groupId: string }
export const seedMembers: MockMember[] = [
  { groupId: 'g-family', userId: 'u-me', name: '오하연', role: 'owner', relation: '딸', joinedAt: WHEN },
  { groupId: 'g-family', userId: 'u-mom', name: '엄마', role: 'member', relation: '엄마', joinedAt: WHEN },
  { groupId: 'g-family', userId: 'u-dad', name: '아빠', role: 'member', relation: '아빠', joinedAt: WHEN },
  { groupId: 'g-aunt', userId: 'u-mom', name: '엄마', role: 'owner', relation: '엄마', joinedAt: WHEN },
  { groupId: 'g-aunt', userId: 'u-me', name: '오하연', role: 'member', relation: '조카', joinedAt: WHEN },
]

// 미리 만들어 둔 초대 링크: /invite/demo-invite-token (이모네 가족이 아니라 새 그룹에 들어오는 체험용)
export const seedInvites: Invite[] = [{ token: DEMO_INVITE_TOKEN, groupId: 'g-aunt', expiresAt: '2099-12-31T00:00:00+09:00' }]

export const seedTravelers: Traveler[] = [
  {
    id: 'tr-mom', label: '엄마', userId: 'u-mom', age: 68, heightCm: 155, sex: 'female', pace: 'slow',
    mobilityAid: false, isParent: true, condition: { continuousMin: 20, dayMin: 90, restMin: 10, avoidStairs: true }, filledBySelf: true,
  },
  {
    id: 'tr-dad', label: '아빠', userId: 'u-dad', age: 70, heightCm: 168, sex: 'male', pace: 'normal',
    mobilityAid: false, isParent: true, condition: { continuousMin: 30 }, filledBySelf: false,
  },
  {
    id: 'tr-me', label: '나', userId: 'u-me', age: 32, heightCm: 162, sex: 'female', pace: 'normal',
    mobilityAid: false, isParent: false, condition: {}, filledBySelf: true,
  },
]

type StopArgs = Partial<Stop> & Pick<Stop, 'key' | 'name'>
export const makeStop = (args: StopArgs): Stop => ({
  placeId: null, mustVisit: false, arriveBy: 'car', skipSegmentIds: [], detourMap: {}, restNodeIds: [], ...args,
})

const lunch = makeStop({ key: 's-lunch', name: '도룡동 한식당', placeId: 'lunch-dorong', startTime: '12:00', visitMin: 60 })

export const v1Stops: Stop[] = [
  makeStop({ key: 's-hanbat', name: '한밭수목원', placeId: 'hanbat', startTime: '09:30', visitMin: 60, mustVisit: true }),
  lunch,
  makeStop({ key: 's-science', name: '국립중앙과학관', placeId: 'science', startTime: '13:30', visitMin: 90, mustVisit: true }),
  makeStop({ key: 's-art', name: '대전시립미술관', placeId: 'art', startTime: '16:00', visitMin: 60, arriveBy: 'taxi' }),
]

// 의견을 반영한 두 번째 안: 계단 구간은 우회로로, 쉼터에서 쉬고, 꼭 보지 않아도 되는 마지막 구간은 뺐다
export const v2Stops: Stop[] = v1Stops.map(stop =>
  stop.key === 's-hanbat'
    ? { ...stop, detourMap: { hb3: 'hb3r' }, restNodeIds: ['hb-rest'], skipSegmentIds: ['hb5'] }
    : stop,
)

const confirmedStops: Stop[] = [
  makeStop({ key: 'c-science', name: '국립중앙과학관', placeId: 'science', startTime: '10:00', visitMin: 90, mustVisit: true }),
  makeStop({ key: 'c-art', name: '대전시립미술관', placeId: 'art', startTime: '13:00', visitMin: 60, arriveBy: 'taxi' }),
]

function version(id: string, tripId: string, number: number, parentId: string | null, madeBy: TripVersion['madeBy'], madeByUserId: string | null, stops: Stop[], note: string | null): TripVersion {
  const { summary } = judgeWithMocks(stops, seedTravelers)
  return { id, tripId, number, parentId, madeBy, madeByUserId, stops, summary, note, createdAt: WHEN }
}

export const seedTrips: Trip[] = [
  {
    id: 't-daejeon', groupId: 'g-family', title: '부모님과 대전 하루 여행', date: '2026-11-14', mode: 'scratch', transport: 'car',
    styles: ['자연·산책', '과학·전시'], budget: '30k_50k', confirmedVersionId: null, confirmedByName: null, createdAt: WHEN,
  },
  {
    id: 't-fall', groupId: 'g-family', title: '가을 소풍', date: '2026-10-25', mode: 'paste', transport: 'transit',
    styles: ['문화·역사'], budget: '30k_50k', confirmedVersionId: 'v-fall-1', confirmedByName: '오하연', createdAt: WHEN,
  },
]

export const seedTripTravelers: Record<string, Traveler[]> = { 't-daejeon': seedTravelers, 't-fall': seedTravelers }

export const seedVersions: TripVersion[] = [
  version('v-daejeon-1', 't-daejeon', 1, null, 'user', 'u-me', v1Stops, null),
  version('v-daejeon-2', 't-daejeon', 2, 'v-daejeon-1', 'ai', null, v2Stops, '의견을 반영해서 다시 짰어요'),
  version('v-fall-1', 't-fall', 1, null, 'user', 'u-me', confirmedStops, null),
]

export const seedOpinions: Opinion[] = [
  {
    id: 'o-1', versionId: 'v-daejeon-1', stopKey: 's-hanbat', userId: 'u-mom', userName: '엄마', reactions: ['stairs_worry'],
    comment: '계단이 많으면 무릎이 아파서 힘들어', appliedInVersionId: 'v-daejeon-2', createdAt: '2026-10-28T10:00:00+09:00',
  },
  {
    id: 'o-2', versionId: 'v-daejeon-1', stopKey: 's-science', userId: 'u-dad', userName: '아빠', reactions: ['must_go'],
    comment: '과학관은 꼭 가고 싶다', appliedInVersionId: 'v-daejeon-2', createdAt: '2026-10-28T10:30:00+09:00',
  },
  {
    id: 'o-3', versionId: 'v-daejeon-1', stopKey: null, userId: 'u-me', userName: '오하연', reactions: [],
    comment: '하루가 좀 빡빡한 것 같아요', appliedInVersionId: 'v-daejeon-2', createdAt: '2026-10-28T11:00:00+09:00',
  },
  {
    id: 'o-4', versionId: 'v-daejeon-2', stopKey: 's-art', userId: 'u-mom', userName: '엄마', reactions: ['need_rest'],
    comment: '미술관에서는 앉아서 쉬고 싶어', appliedInVersionId: null, createdAt: '2026-10-29T09:00:00+09:00',
  },
]
