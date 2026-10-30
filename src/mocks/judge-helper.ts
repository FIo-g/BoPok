// 목업 서버가 하는 일: 일정에 필요한 경로를 모아 엔진으로 판정하고 버전에 붙일 요약을 만든다.
// 실제 서버는 lib/places·lib/geo에서 장소·경로를 받아 같은 엔진을 부른다 (docs/roles/account-trip.md).
import { judge, requiredLegs } from '@/lib/engine'
import { legKey, type JudgeResult, type JudgeSummary, type Leg, type PlaceDetail, type Stop, type Traveler } from '@/lib/contracts'
import { mockLeg } from './legs'
import { mockPlaces } from './places'

export type MockJudged = { result: JudgeResult; summary: JudgeSummary; places: Record<string, PlaceDetail>; legs: Record<string, Leg> }

export function judgeWithMocks(stops: Stop[], travelers: Traveler[], tuned?: Parameters<typeof judge>[0]['tuned']): MockJudged {
  const requests = requiredLegs(stops, mockPlaces)
  const legs: Record<string, Leg> = {}
  for (const req of requests) legs[legKey(req)] = mockLeg(req)
  const result = judge({ travelers, tuned, stops, places: mockPlaces, legs })
  const { verdict, reason, day, longest } = result
  return { result, summary: { verdict, reason, day, longest }, places: mockPlaces, legs }
}
