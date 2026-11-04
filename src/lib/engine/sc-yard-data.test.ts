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

  it('모든 구간의 신뢰 등급은 C다 (안내도 맞춤 지점과 출입 제한 길에 닿는 구간)', () => {
    expect(scYard.segments.length).toBeGreaterThan(0)
    expect(scYard.segments.every(segment => segment.confidence === 'C')).toBe(true)
  })

  it('모든 구간에 출처·확인 날짜·신뢰 등급이 있고 계단이 확인되었다는 표시(confirmed_none)가 없다', () => {
    for (const segment of scYard.segments) {
      expect(segment.source).toBeTruthy()
      expect(segment.checkedAt).toBeTruthy()
      expect(segment.confidence).toBeDefined()
      expect(segment.stairsStatus).not.toBe('confirmed_none')
    }
  })

  it('관람 주 경로 합계는 빌드 값 1784m와 1m 안이다 (선택 구간·우회 구간 제외)', () => {
    const total = scYard.segments
      .filter(segment => segment.courseId !== undefined && segment.detourOf === undefined && !segment.optional)
      .reduce((sum, segment) => sum + segment.distanceM, 0)
    expect(Math.abs(total - 1784)).toBeLessThanOrEqual(1)
  })

  it('안내도 번호(guideNo)는 2·3·4·5다', () => {
    const guideNos = scYard.nodes.flatMap(node => (node.guideNo === undefined ? [] : [node.guideNo])).sort((a, b) => a - b)
    expect(guideNos).toEqual([2, 3, 4, 5])
  })
})
