// 목업 데이터 저장소. 브라우저 localStorage 에 두어 새로고침해도 그룹·일정·의견이 남는다.
// 서버가 없는 개발·시연용이라 비밀번호도 그대로 저장한다 — 실제 로그인(Better Auth)과는 무관하다.
import type { Group, InterviewState, Invite, Opinion, Traveler, Trip, TripVersion } from '@/lib/contracts'
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
  interviews: Record<string, InterviewState>
}

// 시드 모양이 바뀌면 숫자를 올려 이전 저장분을 버린다
const STORAGE_KEY = 'bopok-mock-db-v2'

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
    interviews: {},
  })
}

let cache: MockDb | null = null

export function getDb(): MockDb {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      cache = JSON.parse(raw) as MockDb
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
