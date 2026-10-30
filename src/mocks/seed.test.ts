import { describe, expect, it } from 'vitest'
import { OpinionSchema, PlaceDetailSchema, TravelerSchema, TripSchema, TripVersionSchema } from '@/lib/contracts'
import { judgeWithMocks } from './judge-helper'
import { mockPlaceDetails } from './places'
import { seedOpinions, seedTrips, seedTripTravelers, seedTravelers, seedVersions, v1Stops, v2Stops } from './seed'

describe('목업 시드', () => {
  it('모든 데이터가 contracts 스키마를 통과한다', () => {
    for (const p of mockPlaceDetails) expect(() => PlaceDetailSchema.parse(p)).not.toThrow()
    for (const t of seedTravelers) expect(() => TravelerSchema.parse(t)).not.toThrow()
    for (const t of seedTrips) expect(() => TripSchema.parse(t)).not.toThrow()
    for (const v of seedVersions) expect(() => TripVersionSchema.parse(v)).not.toThrow()
    for (const o of seedOpinions) expect(() => OpinionSchema.parse(o)).not.toThrow()
    expect(Object.keys(seedTripTravelers)).toEqual(['t-daejeon', 't-fall'])
  })

  it('첫 안은 조정이 필요하고 의견을 반영한 둘째 안은 부담이 줄어든다', () => {
    const first = judgeWithMocks(v1Stops, seedTravelers).result
    const second = judgeWithMocks(v2Stops, seedTravelers).result
    console.log('v1', first.verdict, first.reason, JSON.stringify(first.day), JSON.stringify(first.longest), first.violations.length, first.missingLegs.length, first.unknownStopKeys)
    console.log('v2', second.verdict, second.reason, JSON.stringify(second.day), JSON.stringify(second.longest), second.violations.length, second.missingLegs.length)
    expect(first.verdict).toBe('adjust')
    expect(second.violations.length).toBeLessThan(first.violations.length)
  })
})
