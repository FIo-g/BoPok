// 서버 없이 화면을 끝까지 만들 수 있게 하는 가짜 API (NEXT_PUBLIC_USE_MOCKS=1). real.ts 와 같은 Api 모양이다.
// 권한(로그인·구성원·그룹장)과 에러 코드(401·403·404·410)도 서버처럼 흉내 내서 화면의 에러 처리를 미리 확인할 수 있다.
import type { Api, SignInInput, SignUpInput } from '@/lib/api-client/types'
import { ApiRequestError } from '@/lib/api-client/http'
import type { ApiErrorCode, Group, Opinion, Trip, TripListItem, TripVersion, User, VersionSummary } from '@/lib/contracts'
import { judgeWithMocks } from './judge-helper'
import { mockLeg } from './legs'
import { mockExplain, mockGenerate, mockInterview, mockParseSchedule, mockRevise, saveMockVersion } from './mock-ai'
import { mockPlaceDetails, mockPlaces, toSummary } from './places'
import { buildShareText } from './share-text'
import { getDb, nextId, saveDb, type MockDb } from './store'

const LATENCY_MS = 120

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const fail = (status: number, code: ApiErrorCode, message: string): never => {
  throw new ApiRequestError(status, code, message)
}

// 모든 호출의 공통 틀: 짧은 지연 → 실행 → 저장
async function call<T>(fn: (db: MockDb) => T): Promise<T> {
  await sleep(LATENCY_MS)
  const db = getDb()
  const result = fn(db)
  saveDb()
  return structuredClone(result)
}

const publicUser = (u: { id: string; name: string; email: string }): User => ({ id: u.id, name: u.name, email: u.email })

function requireUser(db: MockDb): User {
  const user = db.users.find(u => u.id === db.sessionUserId)
  return user ? publicUser(user) : fail(401, 'unauthorized', '로그인이 필요해요')
}

function requireMember(db: MockDb, groupId: string): User {
  const user = requireUser(db)
  // 구성원이 아니거나 그룹이 없을 때를 모두 403으로 통일한다 (그룹이 있다는 사실이 새어 나가지 않게)
  if (!db.members.some(m => m.groupId === groupId && m.userId === user.id)) fail(403, 'forbidden', '이 그룹의 구성원이 아니에요')
  return user
}

function requireOwner(db: MockDb, groupId: string): User {
  const user = requireMember(db, groupId)
  if (db.groups.find(g => g.id === groupId)?.ownerId !== user.id) fail(403, 'forbidden', '그룹장만 할 수 있어요')
  return user
}

function requireTrip(db: MockDb, tripId: string): { trip: Trip; user: User } {
  const trip = db.trips.find(t => t.id === tripId)
  if (!trip) return fail(404, 'not_found', '여행을 찾을 수 없어요')
  return { trip, user: requireMember(db, trip.groupId) }
}

const nameOf = (db: MockDb, userId?: string | null) => (userId ? db.users.find(u => u.id === userId)?.name ?? null : null)

function summaryOf(db: MockDb, v: TripVersion): VersionSummary {
  const { stops: _stops, ...rest } = v
  void _stops
  return { ...rest, madeByName: nameOf(db, v.madeByUserId) }
}

const versionsOf = (db: MockDb, tripId: string) => db.versions.filter(v => v.tripId === tripId).sort((a, b) => a.number - b.number)

// 여행자 조건이 바뀌면 판정 요약이 낡으므로 그 여행의 모든 버전 요약을 다시 계산한다 (docs/roles/account-trip.md)
function refreshSummaries(db: MockDb, tripId: string): void {
  const travelers = db.travelers[tripId] ?? []
  if (travelers.length === 0) return
  for (const v of versionsOf(db, tripId)) v.summary = judgeWithMocks(v.stops, travelers).summary
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const now = () => new Date().toISOString()

export const mockApi: Api = {
  auth: {
    getSession: () => call(db => {
      const user = db.users.find(u => u.id === db.sessionUserId)
      return user ? publicUser(user) : null
    }),
    signUp: (input: SignUpInput) => call(db => {
      if (db.users.some(u => u.email === input.email)) fail(400, 'invalid_request', '이미 가입된 이메일이에요')
      const user = { id: nextId('u'), name: input.name, email: input.email, password: input.password }
      db.users.push(user)
      db.sessionUserId = user.id
      return publicUser(user)
    }),
    signIn: (input: SignInInput) => call(db => {
      const user = db.users.find(u => u.email === input.email && u.password === input.password)
      if (!user) return fail(401, 'unauthorized', '이메일이나 비밀번호가 맞지 않아요')
      db.sessionUserId = user.id
      return publicUser(user)
    }),
    signOut: () => call(db => {
      db.sessionUserId = null
    }),
  },

  groups: {
    list: () => call(db => {
      const user = requireUser(db)
      return db.groups
        .filter(g => db.members.some(m => m.groupId === g.id && m.userId === user.id))
        .map(g => ({
          ...g,
          memberCount: db.members.filter(m => m.groupId === g.id).length,
          role: g.ownerId === user.id ? ('owner' as const) : ('member' as const),
        }))
    }),
    create: input => call(db => {
      const user = requireUser(db)
      const group: Group = { id: nextId('g'), name: input.name, ownerId: user.id, createdAt: now() }
      db.groups.push(group)
      db.members.push({ groupId: group.id, userId: user.id, name: user.name, role: 'owner', relation: null, joinedAt: now() })
      return group
    }),
    get: groupId => call(db => {
      requireMember(db, groupId)
      const group = db.groups.find(g => g.id === groupId) ?? fail(404, 'not_found', '그룹을 찾을 수 없어요')
      return { ...group, members: db.members.filter(m => m.groupId === groupId).map(({ groupId: _g, ...member }) => { void _g; return member }) }
    }),
    createInvite: groupId => call(db => {
      requireOwner(db, groupId)
      const invite = { token: randomToken(), groupId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }
      db.invites.push(invite)
      return invite
    }),
    removeMember: (groupId, userId) => call(db => {
      requireOwner(db, groupId)
      db.members = db.members.filter(m => !(m.groupId === groupId && m.userId === userId && m.role !== 'owner'))
    }),
    listTrips: groupId => call(db => {
      requireMember(db, groupId)
      return db.trips
        .filter(t => t.groupId === groupId)
        .map((trip): TripListItem => {
          const versions = versionsOf(db, trip.id)
          const latest = versions[versions.length - 1]
          const confirmed = versions.find(v => v.id === trip.confirmedVersionId)
          return { trip, latestVersion: latest ? summaryOf(db, latest) : null, confirmedVersion: confirmed ? summaryOf(db, confirmed) : null }
        })
    }),
  },

  invites: {
    preview: token => call(db => {
      const invite = db.invites.find(i => i.token === token) ?? fail(404, 'not_found', '초대 링크를 찾을 수 없어요')
      if (new Date(invite.expiresAt).getTime() < Date.now()) fail(410, 'expired', '초대 링크가 만료됐어요')
      const group = db.groups.find(g => g.id === invite.groupId) ?? fail(404, 'not_found', '그룹을 찾을 수 없어요')
      return { groupName: group.name, expiresAt: invite.expiresAt }
    }),
    accept: token => call(db => {
      const user = requireUser(db)
      const invite = db.invites.find(i => i.token === token) ?? fail(404, 'not_found', '초대 링크를 찾을 수 없어요')
      if (new Date(invite.expiresAt).getTime() < Date.now()) fail(410, 'expired', '초대 링크가 만료됐어요')
      // 이미 구성원이면 그대로 성공
      if (!db.members.some(m => m.groupId === invite.groupId && m.userId === user.id)) {
        db.members.push({ groupId: invite.groupId, userId: user.id, name: user.name, role: 'member', relation: null, joinedAt: now() })
      }
      return { groupId: invite.groupId }
    }),
  },

  trips: {
    create: input => call(db => {
      const user = requireMember(db, input.groupId)
      void user
      const trip: Trip = {
        id: nextId('t'), groupId: input.groupId, title: input.title, date: input.date ?? null, mode: input.mode, transport: null,
        styles: [], budget: null, confirmedVersionId: null, confirmedByName: null, createdAt: now(),
      }
      db.trips.push(trip)
      db.travelers[trip.id] = []
      return trip
    }),
    get: tripId => call(db => {
      const { trip } = requireTrip(db, tripId)
      return { trip, travelers: db.travelers[tripId] ?? [], versions: versionsOf(db, tripId).map(v => summaryOf(db, v)) }
    }),
    update: (tripId, patch) => call(db => {
      const { trip } = requireTrip(db, tripId)
      Object.assign(trip, patch)
      return trip
    }),
    putTravelers: (tripId, travelers) => call(db => {
      requireTrip(db, tripId)
      db.travelers[tripId] = travelers
      refreshSummaries(db, tripId)
      return travelers
    }),
    patchTraveler: (tripId, travelerId, patch) => call(db => {
      const { user } = requireTrip(db, tripId)
      const traveler = (db.travelers[tripId] ?? []).find(t => t.id === travelerId) ?? fail(404, 'not_found', '여행자를 찾을 수 없어요')
      Object.assign(traveler, patch)
      // 본인 계정과 연결된 여행자를 고치면 본인이 직접 채운 것으로 본다
      if (traveler.userId === user.id) traveler.filledBySelf = true
      refreshSummaries(db, tripId)
      return traveler
    }),
    getVersion: (tripId, versionId) => call(db => {
      requireTrip(db, tripId)
      return db.versions.find(v => v.id === versionId && v.tripId === tripId) ?? fail(404, 'not_found', '버전을 찾을 수 없어요')
    }),
    saveVersion: (tripId, input) => call(db => {
      const { user } = requireTrip(db, tripId)
      if (input.parentId && !db.versions.some(v => v.id === input.parentId && v.tripId === tripId)) fail(400, 'invalid_request', '이전 버전을 찾을 수 없어요')
      return saveMockVersion(tripId, input.parentId, input.madeBy, input.stops, input.note, user.id, db.travelers[tripId] ?? [])
    }),
    confirm: (tripId, versionId) => call(db => {
      const { trip, user } = requireTrip(db, tripId)
      if (!db.versions.some(v => v.id === versionId && v.tripId === tripId)) fail(400, 'invalid_request', '확정할 버전을 찾을 수 없어요')
      // 확정은 여행당 한 버전: 다른 버전을 확정하면 이전 확정은 풀린다
      trip.confirmedVersionId = versionId
      trip.confirmedByName = user.name
      return trip
    }),
    unconfirm: tripId => call(db => {
      const { trip } = requireTrip(db, tripId)
      trip.confirmedVersionId = null
      trip.confirmedByName = null
      return trip
    }),
    shareText: tripId => call(db => {
      const { trip } = requireTrip(db, tripId)
      const version = db.versions.find(v => v.id === trip.confirmedVersionId) ?? fail(404, 'not_found', '확정된 일정이 아직 없어요')
      return { text: buildShareText(trip, version, db.travelers[tripId] ?? []) }
    }),
  },

  opinions: {
    list: versionId => call(db => {
      const version = db.versions.find(v => v.id === versionId) ?? fail(404, 'not_found', '버전을 찾을 수 없어요')
      requireTrip(db, version.tripId)
      return db.opinions.filter(o => o.versionId === versionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }),
    add: (versionId, input) => call(db => {
      const version = db.versions.find(v => v.id === versionId) ?? fail(404, 'not_found', '버전을 찾을 수 없어요')
      const { user } = requireTrip(db, version.tripId)
      const opinion: Opinion = {
        id: nextId('o'), versionId, stopKey: input.stopKey, userId: user.id, userName: user.name,
        reactions: input.reactions, comment: input.comment ?? null, appliedInVersionId: null, createdAt: now(),
      }
      db.opinions.push(opinion)
      return opinion
    }),
    remove: opinionId => call(db => {
      const user = requireUser(db)
      const opinion = db.opinions.find(o => o.id === opinionId) ?? fail(404, 'not_found', '의견을 찾을 수 없어요')
      if (opinion.userId !== user.id) fail(403, 'forbidden', '내 의견만 지울 수 있어요')
      db.opinions = db.opinions.filter(o => o.id !== opinionId)
    }),
  },

  places: {
    list: (query = {}) => call(() =>
      mockPlaceDetails
        .filter(p => !query.q || p.name.includes(query.q))
        .filter(p => !query.styles?.length || p.styles.some(s => query.styles?.includes(s)))
        .map(toSummary),
    ),
    get: placeId => call(() => mockPlaces[placeId] ?? fail(404, 'not_found', '장소를 찾을 수 없어요')),
    details: ids => call(() => ids.map(id => mockPlaces[id]).filter((p): p is NonNullable<typeof p> => Boolean(p))),
  },

  legs: {
    get: requests => call(() => requests.map(mockLeg)),
  },

  ai: {
    interview: input => call(db => {
      const { trip } = requireTrip(db, input.tripId)
      const res = mockInterview(trip, input)
      // 인터뷰가 끝나면 서버가 여행자와 여행 정보를 저장한다
      if (res.done) {
        if (res.filled.travelers.length > 0) db.travelers[trip.id] = res.filled.travelers
        trip.styles = res.filled.styles.length ? res.filled.styles : trip.styles
        trip.budget = res.filled.budget ?? trip.budget
        trip.date = res.filled.date ?? trip.date
        trip.transport = res.filled.transport ?? trip.transport
      }
      return res
    }),
    parseSchedule: input => call(db => {
      requireTrip(db, input.tripId)
      return mockParseSchedule(input.text)
    }),
    generate: input => call(db => {
      const { trip } = requireTrip(db, input.tripId)
      const interview = db.interviews[trip.id]?.filled
      if (interview?.travelers.length) db.travelers[trip.id] = interview.travelers
      if (interview) {
        trip.styles = interview.styles.length ? interview.styles : trip.styles
        trip.budget = interview.budget ?? trip.budget
        trip.date = interview.date ?? trip.date
        trip.transport = interview.transport ?? trip.transport
      }
      return mockGenerate(trip, db.travelers[trip.id] ?? [])
    }),
    revise: input => call(db => {
      const { trip } = requireTrip(db, input.tripId)
      return mockRevise(trip, input.versionId, db.travelers[trip.id] ?? [])
    }),
    explain: input => call(db => {
      requireTrip(db, input.tripId)
      return { text: mockExplain(input.prev, input.next, input.changes), source: 'fixed' as const }
    }),
  },
}
