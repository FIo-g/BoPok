// 실제 서버 API 호출. 경로와 모양은 docs/roles/account-trip.md, data-geo.md, ai-engine.md 의 API 표를 따른다.
import { z } from 'zod'
import {
  AcceptInviteResponseSchema,
  ExplainResponseSchema,
  GroupDetailSchema,
  GroupSchema,
  GroupSummarySchema,
  InterviewResponseSchema,
  InvitePreviewSchema,
  InviteSchema,
  LegsResponseSchema,
  OpinionSchema,
  ParseScheduleResponseSchema,
  PlaceDetailSchema,
  PlaceSummarySchema,
  PlanResponseSchema,
  ReviseResponseSchema,
  ShareTextResponseSchema,
  TravelerSchema,
  TripDetailSchema,
  TripListItemSchema,
  TripSchema,
  TripVersionSchema,
  UserSchema,
  type User,
} from '@/lib/contracts'
import { request } from './http'
import type { Api } from './types'

const enc = encodeURIComponent

// Better Auth 의 응답에서 화면이 쓰는 값만 꺼낸다 (user 에 더 많은 칸이 있어도 UserSchema 가 걸러 준다)
const AuthResultSchema = z.object({ user: UserSchema })
const SessionSchema = z.object({ user: UserSchema }).nullable()

const userOf = (result: { user: User }) => result.user

export const realApi: Api = {
  auth: {
    getSession: async () => (await request('/api/auth/get-session', { schema: SessionSchema }))?.user ?? null,
    signUp: async input => userOf(await request('/api/auth/sign-up/email', { method: 'POST', body: input, schema: AuthResultSchema })),
    signIn: async input => userOf(await request('/api/auth/sign-in/email', { method: 'POST', body: input, schema: AuthResultSchema })),
    signOut: async () => {
      await request('/api/auth/sign-out', { method: 'POST', body: {} })
    },
  },
  groups: {
    list: () => request('/api/groups', { schema: z.array(GroupSummarySchema) }),
    create: input => request('/api/groups', { method: 'POST', body: input, schema: GroupSchema }),
    get: groupId => request(`/api/groups/${enc(groupId)}`, { schema: GroupDetailSchema }),
    createInvite: groupId => request(`/api/groups/${enc(groupId)}/invites`, { method: 'POST', body: {}, schema: InviteSchema }),
    removeMember: async (groupId, userId) => {
      await request(`/api/groups/${enc(groupId)}/members/${enc(userId)}`, { method: 'DELETE' })
    },
    listTrips: groupId => request(`/api/groups/${enc(groupId)}/trips`, { schema: z.array(TripListItemSchema) }),
  },
  invites: {
    preview: token => request(`/api/invites/${enc(token)}`, { schema: InvitePreviewSchema }),
    accept: token => request(`/api/invites/${enc(token)}/accept`, { method: 'POST', body: {}, schema: AcceptInviteResponseSchema }),
  },
  trips: {
    create: input => request('/api/trips', { method: 'POST', body: input, schema: TripSchema }),
    get: tripId => request(`/api/trips/${enc(tripId)}`, { schema: TripDetailSchema }),
    update: (tripId, patch) => request(`/api/trips/${enc(tripId)}`, { method: 'PATCH', body: patch, schema: TripSchema }),
    putTravelers: (tripId, travelers) =>
      request(`/api/trips/${enc(tripId)}/travelers`, { method: 'PUT', body: { travelers }, schema: z.array(TravelerSchema) }),
    patchTraveler: (tripId, travelerId, patch) =>
      request(`/api/trips/${enc(tripId)}/travelers/${enc(travelerId)}`, { method: 'PATCH', body: patch, schema: TravelerSchema }),
    getVersion: (tripId, versionId) => request(`/api/trips/${enc(tripId)}/versions/${enc(versionId)}`, { schema: TripVersionSchema }),
    saveVersion: (tripId, input) => request(`/api/trips/${enc(tripId)}/versions`, { method: 'POST', body: input, schema: TripVersionSchema }),
    confirm: (tripId, versionId) => request(`/api/trips/${enc(tripId)}/confirm`, { method: 'POST', body: { versionId }, schema: TripSchema }),
    unconfirm: tripId => request(`/api/trips/${enc(tripId)}/confirm`, { method: 'DELETE', schema: TripSchema }),
    shareText: tripId => request(`/api/trips/${enc(tripId)}/share-text`, { schema: ShareTextResponseSchema }),
  },
  opinions: {
    list: versionId => request(`/api/versions/${enc(versionId)}/opinions`, { schema: z.array(OpinionSchema) }),
    add: (versionId, input) => request(`/api/versions/${enc(versionId)}/opinions`, { method: 'POST', body: input, schema: OpinionSchema }),
    remove: async opinionId => {
      await request(`/api/opinions/${enc(opinionId)}`, { method: 'DELETE' })
    },
  },
  places: {
    list: (query = {}) => {
      const params = new URLSearchParams()
      if (query.q) params.set('q', query.q)
      if (query.styles?.length) params.set('styles', query.styles.join(','))
      const qs = params.toString()
      return request(`/api/places${qs ? `?${qs}` : ''}`, { schema: z.array(PlaceSummarySchema) })
    },
    get: placeId => request(`/api/places/${enc(placeId)}`, { schema: PlaceDetailSchema }),
    details: ids => request('/api/places/details', { method: 'POST', body: { ids }, schema: z.array(PlaceDetailSchema) }),
  },
  legs: {
    get: requests => request('/api/legs', { method: 'POST', body: { requests }, schema: LegsResponseSchema }),
  },
  ai: {
    interview: input => request('/api/ai/interview', { method: 'POST', body: input, schema: InterviewResponseSchema }),
    parseSchedule: input => request('/api/ai/parse-schedule', { method: 'POST', body: input, schema: ParseScheduleResponseSchema }),
    generate: input => request('/api/ai/generate', { method: 'POST', body: input, schema: PlanResponseSchema }),
    revise: input => request('/api/ai/revise', { method: 'POST', body: input, schema: ReviseResponseSchema }),
    explain: input => request('/api/ai/explain', { method: 'POST', body: input, schema: ExplainResponseSchema }),
  },
}
