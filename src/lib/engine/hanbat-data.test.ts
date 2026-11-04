// 실제 적재 데이터(data/places/hanbat.json)로 엔진이 한밭수목원을 '정보 없음'이 아니라 구간으로 계산하는지 본다.
// 픽스처가 아니라 파일을 읽으므로 데이터를 다시 만들면 이 테스트가 같이 확인한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlaceDetailSchema, type JudgeInput, type PlaceDetail, type Stop, type Traveler } from '@/lib/contracts'
import { judge } from './judge'
import { buildDayRoute, type RouteStep } from './route'

const hanbat: PlaceDetail = PlaceDetailSchema.parse(
  JSON.parse(readFileSync(new URL('../../../data/places/hanbat.json', import.meta.url), 'utf8')),
)

const mom: Traveler = {
  id: 't1',
  label: '엄마',
  isParent: true,
  pace: 'normal',
  mobilityAid: false,
  condition: {},
  filledBySelf: true,
}

// 차로 와서 주차장 → 입구 → 관람 → 출구 순서로 도는 하루 일정 하나.
const stop: Stop = {
  key: 'hb-day',
  placeId: 'hanbat',
  name: hanbat.name,
  mustVisit: true,
  arriveBy: 'car',
  skipSegmentIds: [],
  detourMap: {},
  restNodeIds: [],
}

const input: JudgeInput = { travelers: [mom], stops: [stop], places: { hanbat }, legs: {} }

type SegmentStep = Extract<RouteStep, { kind: 'segment' }>
const segmentSteps = (steps: RouteStep[]): SegmentStep[] => steps.filter((step): step is SegmentStep => step.kind === 'segment')

describe('한밭수목원 실제 데이터의 엔진 계산', () => {
  it('정보 없음(unknown)으로 빠지지 않고 장소 안 구간을 계산한다', () => {
    const steps = buildDayRoute(input.stops, input.places)
    expect(steps.some(step => step.kind === 'unknown')).toBe(false)
    expect(segmentSteps(steps).length).toBeGreaterThan(0)
    const result = judge(input)
    expect(result.unknownStopKeys).toEqual([])
    expect(result.stops[0]?.known).toBe(true)
  })

  it('관람 구간의 합계 거리는 800~2000m 범위다', () => {
    const tour = segmentSteps(buildDayRoute(input.stops, input.places))
      .filter(step => !step.reverse && step.segment.courseId !== undefined && step.segment.detourOf === undefined)
    const total = tour.reduce((sum, step) => sum + step.segment.distanceM, 0)
    expect(total).toBeGreaterThanOrEqual(800)
    expect(total).toBeLessThanOrEqual(2000)
  })

  it('계단이 있는 관람 구간을 우회로로 바꾸면 그 구간 계산이 우회로 거리를 쓴다', () => {
    const plain = segmentSteps(buildDayRoute([stop], input.places))
    const toiletLeg = plain.find(step => step.segment.id === 'hb-t1')
    expect(toiletLeg?.segment.stairsStatus).toBe('present')
    const detoured = segmentSteps(buildDayRoute([{ ...stop, detourMap: { 'hb-t1': 'hb-t1d' } }], input.places))
    expect(detoured.find(step => step.segment.id === 'hb-t1d')?.segment.distanceM).toBe(
      hanbat.segments.find(segment => segment.id === 'hb-t1d')?.distanceM,
    )
  })
})
