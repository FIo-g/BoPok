import { describe, expect, it } from 'vitest'
import { LegsInputSchema } from '@/lib/geo/validation'
import { BoundedPlaceDetailsRequestSchema } from '@/lib/places/validation'
import {
  CreateTripRequestSchema, LEGS_REQUEST_MAX, LegsRequestSchema, LegsResponseSchema, PLACE_DETAILS_IDS_MAX, PlaceDetailsRequestSchema,
  PlaceDetailsResponseSchema, PutTravelersRequestSchema, TRAVELERS_MAX, TripSchema, UpdateTripRequestSchema,
  type LegRequest, type LegsResponse, type PlaceDetailsResponse, type Traveler,
} from './index'

// 여행 API 계약(trip-api.ts)의 날짜 검사와 크기 상한. 상한은 서버 검증(geo·places)과 같은 경계여야 한다
const trip = { id: 't', groupId: 'g', title: '여행', date: '2026-11-14', mode: 'scratch', styles: [], confirmedVersionId: null, createdAt: '2026-10-30T00:00:00Z' }

const leg = (i: number): LegRequest => ({ from: { coord: [127 + i / 1000, 36.36] }, to: { coord: [127.5, 36.37] }, mode: 'walk' })
const legs = (n: number): LegRequest[] => Array.from({ length: n }, (_, i) => leg(i))
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i}`)
const traveler = (i: number): Traveler => ({ id: `t${i}`, label: `사람 ${i}`, pace: 'unknown', mobilityAid: false, isParent: false, condition: {}, filledBySelf: false })
const travelers = (n: number): Traveler[] => Array.from({ length: n }, (_, i) => traveler(i))

describe('여행 날짜는 달력에 있는 날짜만', () => {
  it('실제 있는 날짜(윤년 2월 29일 포함)는 통과한다', () => {
    for (const date of ['2026-11-14', '2028-02-29', '2026-12-31', '2026-01-01']) {
      expect(TripSchema.safeParse({ ...trip, date }).success).toBe(true)
    }
  })

  it('정규식은 통과해도 달력에 없는 날짜나 모양이 다른 날짜는 거부한다', () => {
    for (const date of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-32', '2026-1-14', '2026/11/14']) {
      expect(TripSchema.safeParse({ ...trip, date }).success).toBe(false)
    }
  })

  it('날짜가 없는 여행(null·생략)은 그대로 통과한다', () => {
    expect(TripSchema.safeParse({ ...trip, date: null }).success).toBe(true)
    expect(CreateTripRequestSchema.safeParse({ groupId: 'g', title: '여행', mode: 'scratch' }).success).toBe(true)
    expect(UpdateTripRequestSchema.safeParse({ date: null }).success).toBe(true)
  })

  it('만들기·고치기 요청도 없는 날짜를 거부한다', () => {
    expect(CreateTripRequestSchema.safeParse({ groupId: 'g', title: '여행', mode: 'scratch', date: '2026-02-30' }).success).toBe(false)
    expect(UpdateTripRequestSchema.safeParse({ date: '2026-02-30' }).success).toBe(false)
    expect(UpdateTripRequestSchema.safeParse({ date: '2026-11-14' }).success).toBe(true)
  })
})

describe('요청 목록 크기 상한', () => {
  it('경로 요청은 서버(LegsInputSchema)와 같은 경계까지만 받는다', () => {
    expect(LEGS_REQUEST_MAX).toBe(20)
    for (const [count, ok] of [[LEGS_REQUEST_MAX, true], [LEGS_REQUEST_MAX + 1, false]] as const) {
      expect(LegsRequestSchema.safeParse({ requests: legs(count) }).success).toBe(ok)
      expect(LegsInputSchema.safeParse({ requests: legs(count) }).success).toBe(ok)
    }
  })

  it('장소 상세 ID 는 서버(BoundedPlaceDetailsRequestSchema)와 같은 경계까지만 받는다', () => {
    expect(PLACE_DETAILS_IDS_MAX).toBe(100)
    for (const [count, ok] of [[PLACE_DETAILS_IDS_MAX, true], [PLACE_DETAILS_IDS_MAX + 1, false]] as const) {
      expect(PlaceDetailsRequestSchema.safeParse({ ids: ids(count) }).success).toBe(ok)
      expect(BoundedPlaceDetailsRequestSchema.safeParse({ ids: ids(count) }).success).toBe(ok)
    }
  })

  it('여행자 목록은 1명 이상 TRAVELERS_MAX 명 이하', () => {
    expect(PutTravelersRequestSchema.safeParse({ travelers: [] }).success).toBe(false)
    expect(PutTravelersRequestSchema.safeParse({ travelers: travelers(1) }).success).toBe(true)
    expect(PutTravelersRequestSchema.safeParse({ travelers: travelers(TRAVELERS_MAX) }).success).toBe(true)
    expect(PutTravelersRequestSchema.safeParse({ travelers: travelers(TRAVELERS_MAX + 1) }).success).toBe(false)
  })
})

describe('응답 스키마의 타입', () => {
  it('PlaceDetailsResponse, LegsResponse 타입을 내보내고 빈 목록을 통과시킨다', () => {
    const places: PlaceDetailsResponse = []
    const result: LegsResponse = []
    expect(PlaceDetailsResponseSchema.parse(places)).toEqual([])
    expect(LegsResponseSchema.parse(result)).toEqual([])
  })
})
