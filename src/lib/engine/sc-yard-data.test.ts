// 실제 적재 데이터(data/places/inside/tourapi-14-129785.json)로 국립중앙과학관 야외 한 바퀴를 엔진이 '정보 없음'이 아니라 구간으로 계산하는지 본다.
// 장소 안 파일에는 장소 기본 칸(이름·좌표)이 없어, 테스트에서만 이름과 좌표를 채워 PlaceDetail로 검사한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlaceDetailSchema, type PlaceDetail, type Stop, type Traveler } from '@/lib/contracts'
import { judge } from './judge'
import { buildDayRoute, type RouteStep } from './route'

const inside: unknown = JSON.parse(readFileSync(new URL('../../../data/places/inside/tourapi-14-129785.json', import.meta.url), 'utf8'))
const scYard: PlaceDetail = PlaceDetailSchema.parse({
  id: 'tourapi-14-129785',
  name: '국립중앙과학관',
  category: '박물관·과학관',
  styles: [],
  coord: [127.377125, 36.375565],
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

// 차로 와서 주차장 → 정문 → 관람 → 출구 순서로 도는 하루 일정 하나.
const stop: Stop = {
  key: 'sc-day',
  placeId: 'tourapi-14-129785',
  name: scYard.name,
  mustVisit: true,
  arriveBy: 'car',
  skipSegmentIds: [],
  detourMap: {},
  restNodeIds: [],
}

type SegmentStep = Extract<RouteStep, { kind: 'segment' }>
const segmentSteps = (steps: RouteStep[]): SegmentStep[] => steps.filter((step): step is SegmentStep => step.kind === 'segment')

describe('국립중앙과학관 실제 데이터의 엔진 계산', () => {
  it('정보 없음(unknown)으로 빠지지 않고 장소 안 구간을 계산한다', () => {
    const steps = buildDayRoute([stop], { 'tourapi-14-129785': scYard })
    expect(steps.some(step => step.kind === 'unknown')).toBe(false)
    expect(segmentSteps(steps).length).toBeGreaterThan(0)
    const result = judge({ travelers: [mom], stops: [stop], places: { 'tourapi-14-129785': scYard }, legs: {} })
    expect(result.unknownStopKeys).toEqual([])
    expect(result.stops[0]?.known).toBe(true)
  })

  it('관람 구간의 합계 거리는 300~2500m 범위다 (선택 구간 제외)', () => {
    const tour = segmentSteps(buildDayRoute([stop], { 'tourapi-14-129785': scYard }))
      .filter(step => !step.reverse && step.segment.courseId !== undefined && step.segment.detourOf === undefined && !step.segment.optional)
    const total = tour.reduce((sum, step) => sum + step.segment.distanceM, 0)
    expect(total).toBeGreaterThanOrEqual(300)
    expect(total).toBeLessThanOrEqual(2500)
  })

  it('안내도 번호(guideNo)가 있는 볼거리 지점이 있다', () => {
    const sights = scYard.nodes.filter(node => node.kind === 'sight' && node.guideNo !== undefined)
    expect(sights.length).toBeGreaterThan(0)
  })
})
