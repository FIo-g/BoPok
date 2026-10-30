import { describe, expect, it } from 'vitest'
import {
  CreateGroupRequestSchema, CreateTripRequestSchema, GroupDetailSchema, SaveVersionRequestSchema, TripListItemSchema,
  TripSchema, UpdateTripRequestSchema, VersionSummarySchema,
} from './index'

// 화면(프론트)이 필요해서 더한 그룹·여행 API 모양 (group.ts, trip-api.ts)
const trip = { id: 't', groupId: 'g', title: '여행', date: '2026-11-14', mode: 'scratch', styles: [], confirmedVersionId: null, createdAt: '2026-10-30T00:00:00Z' }
const version = { id: 'v', tripId: 't', number: 1, parentId: null, madeBy: 'user', createdAt: '2026-10-30T00:00:00Z' }

describe('그룹·여행 계약', () => {
  it('그룹 이름은 비어 있으면 안 되고 앞뒤 공백은 뗀다', () => {
    expect(CreateGroupRequestSchema.parse({ name: ' 우리 가족 ' }).name).toBe('우리 가족')
    expect(CreateGroupRequestSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('그룹 상세는 구성원을 담는다', () => {
    const group = { id: 'g', name: '가족', ownerId: 'u', createdAt: 'x', members: [{ userId: 'u', name: '나', role: 'owner', joinedAt: 'x' }] }
    expect(GroupDetailSchema.parse(group).members).toHaveLength(1)
    expect(GroupDetailSchema.safeParse({ ...group, members: [{ userId: 'u', name: '나', role: 'boss', joinedAt: 'x' }] }).success).toBe(false)
  })

  it('여행 날짜는 YYYY-MM-DD, 확정 버전은 null 이면 작성 중', () => {
    expect(TripSchema.parse(trip).confirmedVersionId).toBeNull()
    expect(TripSchema.safeParse({ ...trip, date: '2026/11/14' }).success).toBe(false)
  })

  it('버전 요약에는 stops 가 없고 만든 사람 이름이 붙는다', () => {
    const summary = VersionSummarySchema.parse({ ...version, madeByName: '오하연' })
    expect('stops' in summary).toBe(false)
    expect(TripListItemSchema.parse({ trip, latestVersion: summary, confirmedVersion: null }).latestVersion?.madeByName).toBe('오하연')
  })

  it('여행 만들기·고치기·버전 저장 요청', () => {
    expect(CreateTripRequestSchema.safeParse({ groupId: 'g', title: '여행', mode: 'paste' }).success).toBe(true)
    expect(CreateTripRequestSchema.safeParse({ groupId: 'g', title: '여행', mode: 'other' }).success).toBe(false)
    expect(UpdateTripRequestSchema.parse({ budget: '30k_50k' })).toEqual({ budget: '30k_50k' })
    expect(SaveVersionRequestSchema.safeParse({ parentId: null, stops: [], madeBy: 'ai' }).success).toBe(false)
  })
})
