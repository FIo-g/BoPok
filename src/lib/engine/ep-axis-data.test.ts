// 실제 적재 데이터(data/places/inside/tourapi-12-2738037.json)로 엔진이 엑스포시민광장 한 바퀴를 '정보 없음'이 아니라 구간으로 계산하는지 본다.
// 장소 안 파일에는 장소 기본 칸(이름·좌표)이 없어, 테스트에서만 이름과 좌표를 채워 PlaceDetail로 검사한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlaceDetailSchema, type PlaceDetail, type Stop, type Traveler } from '@/lib/contracts'
import { judge } from './judge'
import { buildDayRoute, type RouteStep } from './route'

const inside: unknown = JSON.parse(readFileSync(new URL('../../../data/places/inside/tourapi-12-2738037.json', import.meta.url), 'utf8'))
const epAxis: PlaceDetail = PlaceDetailSchema.parse({
  id: 'tourapi-12-2738037',
  name: '대전엑스포시민광장',
  category: '광장',
  styles: [],
  coord: [127.387992, 36.365043],
  seated: false,
  indoor: false,
  confidence: 'B',
  ...(inside as object),
})

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
  key: 'ep-day',
  placeId: 'tourapi-12-2738037',
  name: epAxis.name,
  mustVisit: true,
  arriveBy: 'car',
  skipSegmentIds: [],
  detourMap: {},
  restNodeIds: [],
}

type SegmentStep = Extract<RouteStep, { kind: 'segment' }>
const segmentSteps = (steps: RouteStep[]): SegmentStep[] => steps.filter((step): step is SegmentStep => step.kind === 'segment')

describe('엑스포시민광장 실제 데이터의 엔진 계산', () => {
  it('정보 없음(unknown)으로 빠지지 않고 장소 안 구간을 계산한다', () => {
    const steps = buildDayRoute([stop], { 'tourapi-12-2738037': epAxis })
    expect(steps.some(step => step.kind === 'unknown')).toBe(false)
    expect(segmentSteps(steps).length).toBeGreaterThan(0)
    const result = judge({ travelers: [mom], stops: [stop], places: { 'tourapi-12-2738037': epAxis }, legs: {} })
    expect(result.unknownStopKeys).toEqual([])
    expect(result.stops[0]?.known).toBe(true)
  })

  it('관람 구간의 합계 거리는 300~2000m 범위다 (선택 구간 제외)', () => {
    const tour = segmentSteps(buildDayRoute([stop], { 'tourapi-12-2738037': epAxis }))
      .filter(step => !step.reverse && step.segment.courseId !== undefined && step.segment.detourOf === undefined && !step.segment.optional)
    const total = tour.reduce((sum, step) => sum + step.segment.distanceM, 0)
    expect(total).toBeGreaterThanOrEqual(300)
    expect(total).toBeLessThanOrEqual(2000)
  })
})
