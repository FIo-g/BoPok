// 목업 데이터 저장소. 브라우저 localStorage 에 두어 새로고침해도 그룹·일정·의견이 남는다.
// 서버가 없는 개발·시연용이라 비밀번호도 그대로 저장한다 — 실제 로그인(Better Auth)과는 무관하다.
import type { ChatMessage, DayFeedbackItem, Group, InterviewState, Invite, Opinion, Traveler, TravelerHealth, Trip, TripVersion } from '@/lib/contracts'
import {
  seedGroups, seedInvites, seedMembers, seedOpinions, seedTrips, seedTripTravelers, seedUsers, seedVersions,
  type MockMember, type MockUser,
} from './seed'

export type MockDb = {
  seq: number
  sessionUserId: string | null
  users: MockUser[]
  groups: Group[]
  members: MockMember[]
  invites: Invite[]
  trips: Trip[]
  travelers: Record<string, Traveler[]>
  versions: TripVersion[]
  opinions: Opinion[]
  feedback: DayFeedbackItem[]
  chat: ChatMessage[]
  // 건강 정보. (tripId, travelerId)가 키다 — 시드는 두 여행이 같은 여행자 id 를 쓰므로 tripId 없이는 섞인다
  health: TravelerHealth[]
  interviews: Record<string, InterviewState>
}

// 시드 모양이 바뀌면 숫자를 올려 이전 저장분을 버린다
const STORAGE_KEY = 'bopok-mock-db-v4'

function seed(): MockDb {
  return structuredClone({
    seq: 100,
    sessionUserId: null,
    users: seedUsers,
    groups: seedGroups,
    members: seedMembers,
    invites: seedInvites,
    trips: seedTrips,
    travelers: seedTripTravelers,
    versions: seedVersions,
    opinions: seedOpinions,
    feedback: [],
    chat: [],
    health: [],
    interviews: {},
  })
}

let cache: MockDb | null = null

export function getDb(): MockDb {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      // 다른 브랜치가 같은 번호로 다른 칸을 더했을 수 있어, 저장분에 없는 칸은 시드 값으로 채운다
      // (예: 건강 정보 칸이 없는 저장분에서 db.health 를 읽다 깨지지 않게)
      cache = { ...seed(), ...(JSON.parse(raw) as Partial<MockDb>) }
      return cache
    }
  } catch {
    // 저장소를 못 쓰거나 깨졌으면 처음 데이터로 시작한다
  }
  cache = seed()
  return cache
}

export function saveDb(): void {
  if (!cache) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 창 등)에서는 이번 탭 동안만 유지된다
  }
}

export function resetMockDb(): void {
  cache = seed()
  saveDb()
}

export function nextId(prefix: string): string {
  const db = getDb()
  db.seq += 1
  return `${prefix}-${db.seq}`
}
