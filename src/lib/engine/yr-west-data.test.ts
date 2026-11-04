// 실제 적재 데이터(data/places/inside/tourapi-12-2674960.json)로 유림공원 서쪽 한 바퀴를 엔진이 '정보 없음'이 아니라 구간으로 계산하는지 본다.
// 장소 안 파일에는 장소 기본 칸(이름·좌표)이 없어, 테스트에서만 이름과 좌표를 채워 PlaceDetail로 검사한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlaceDetailSchema, type PlaceDetail, type Stop, type Traveler } from '@/lib/contracts'
import { judge } from './judge'
import { buildDayRoute, type RouteStep } from './route'

const inside: unknown = JSON.parse(readFileSync(new URL('../../../data/places/inside/tourapi-12-2674960.json', import.meta.url), 'utf8'))
const yuseong: PlaceDetail = PlaceDetailSchema.parse({
  id: 'tourapi-12-2674960',
  name: '유림공원',
  category: '공원',
  styles: [],
  coord: [127.354744, 36.359757],
  seated: false,
  indoor: false,
  confidence: 'C',
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
  key: 'yr-day',
  placeId: 'tourapi-12-2674960',
  name: yuseong.name,
  mustVisit: true,
  arriveBy: 'car',
  skipSegmentIds: [],
  detourMap: {},
  restNodeIds: [],
}

type SegmentStep = Extract<RouteStep, { kind: 'segment' }>
const segmentSteps = (steps: RouteStep[]): SegmentStep[] => steps.filter((step): step is SegmentStep => step.kind === 'segment')

describe('유림공원 실제 데이터의 엔진 계산', () => {
  it('정보 없음(unknown)으로 빠지지 않고 장소 안 구간을 계산한다', () => {
    const steps = buildDayRoute([stop], { 'tourapi-12-2674960': yuseong })
    expect(steps.some(step => step.kind === 'unknown')).toBe(false)
    expect(segmentSteps(steps).length).toBeGreaterThan(0)
    const result = judge({ travelers: [mom], stops: [stop], places: { 'tourapi-12-2674960': yuseong }, legs: {} })
    expect(result.unknownStopKeys).toEqual([])
    expect(result.stops[0]?.known).toBe(true)
  })

  it('관람 구간의 합계 거리는 300~2000m 범위다 (선택 구간 제외)', () => {
    const tour = segmentSteps(buildDayRoute([stop], { 'tourapi-12-2674960': yuseong }))
      .filter(step => !step.reverse && step.segment.courseId !== undefined && step.segment.detourOf === undefined && !step.segment.optional)
    const total = tour.reduce((sum, step) => sum + step.segment.distanceM, 0)
    expect(total).toBeGreaterThanOrEqual(300)
    expect(total).toBeLessThanOrEqual(2000)
  })

  it('안내도 번호(guideNo)가 있는 볼거리 지점이 있다', () => {
    const sights = yuseong.nodes.filter(node => node.kind === 'sight' && node.guideNo !== undefined)
    expect(sights.length).toBeGreaterThan(0)
  })

  it('모든 구간의 신뢰 등급은 C다', () => {
    expect(yuseong.segments.length).toBeGreaterThan(0)
    expect(yuseong.segments.every(segment => segment.confidence === 'C')).toBe(true)
  })

  it('모든 구간에 출처·확인 날짜·신뢰 등급이 있고 계단이 확인되었다는 표시(confirmed_none)가 없다', () => {
    for (const segment of yuseong.segments) {
      expect(segment.source).toBeTruthy()
      expect(segment.checkedAt).toBeTruthy()
      expect(segment.confidence).toBeDefined()
      expect(segment.stairsStatus).not.toBe('confirmed_none')
    }
  })

  it('관람 주 경로 합계는 빌드 값 829m와 1m 안이다 (선택 구간·우회 구간 제외)', () => {
    const total = yuseong.segments
      .filter(segment => segment.courseId !== undefined && segment.detourOf === undefined && !segment.optional)
      .reduce((sum, segment) => sum + segment.distanceM, 0)
    expect(Math.abs(total - 829)).toBeLessThanOrEqual(1)
  })

  it('안내도 번호(guideNo)는 4·5·9·13이다', () => {
    const guideNos = yuseong.nodes.flatMap(node => (node.guideNo === undefined ? [] : [node.guideNo])).sort((a, b) => a - b)
    expect(guideNos).toEqual([4, 5, 9, 13])
  })
})
