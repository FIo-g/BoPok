import { describe, expect, it } from 'vitest'
import type { Stop } from '@/lib/contracts'
import { buildDayRoute, type RouteStep } from './route'
import { places } from './test-fixtures'

function makeStop(key: string, placeId: string | null, over: Partial<Stop> = {}): Stop {
  const place = placeId ? places[placeId] : undefined
  return {
    key,
    placeId,
    name: place?.name ?? '점심',
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...over,
  }
}

type SegmentStep = Extract<RouteStep, { kind: 'segment' }>
type LegStep = Extract<RouteStep, { kind: 'leg' }>

function segmentSteps(steps: RouteStep[]): SegmentStep[] {
  return steps.filter((step): step is SegmentStep => step.kind === 'segment')
}

function legSteps(steps: RouteStep[]): LegStep[] {
  return steps.filter((step): step is LegStep => step.kind === 'leg')
}

function segmentIds(steps: RouteStep[]): string[] {
  return segmentSteps(steps).map(step => step.segment.id)
}

describe('buildDayRoute', () => {
  it('차로 오면 주차장 → 입구 → 볼거리', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat', { arriveBy: 'car' })], places)
    expect(segmentIds(steps)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(segmentSteps(steps).every(step => step.reverse === false)).toBe(true)
  })

  it('버스로 오면 정류장에서', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat', { arriveBy: 'bus' })], places)
    expect(segmentIds(steps)[0]).toBe('s1b')
    expect(segmentIds(steps)).toEqual(['s1b', 's2', 's3', 's4', 's5'])
  })

  it('걸어서 오면 입구부터', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat', { arriveBy: 'walk' })], places)
    expect(segmentIds(steps)[0]).toBe('s2')
    expect(segmentIds(steps)).toEqual(['s2', 's3', 's4', 's5'])
  })

  it('다음이 차면 주차장으로 돌아가는 길', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat'), makeStop('k2', 'science')], places)
    expect(segmentIds(steps)).toEqual(['s1', 's2', 's3', 's4', 's5', 's1', 'c1', 'c2', 'c3'])

    const hanbatSegments = segmentSteps(steps).filter(step => step.stopKey === 'k1')
    expect(hanbatSegments.at(-1)?.segment.id).toBe('s1')
    expect(hanbatSegments.at(-1)?.reverse).toBe(true)

    const [leg] = legSteps(steps)
    expect(leg.mode).toBe('car')
    expect(leg.fromStopKey).toBe('k1')
    expect(leg.toStopKey).toBe('k2')
    expect(leg.request?.from).toEqual({ placeId: 'hanbat', nodeId: 'P', coord: [127.384, 36.35] })
    expect(leg.request?.to).toEqual({ placeId: 'science', nodeId: 'P2', coord: [127.3745, 36.3735] })
  })

  it('마지막 장소는 돌아가는 길 없음', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat'), makeStop('k2', 'science')], places)
    const scienceSegments = segmentSteps(steps).filter(step => step.stopKey === 'k2')
    expect(scienceSegments.map(step => step.segment.id)).toEqual(['c1', 'c2', 'c3'])
    expect(scienceSegments.every(step => step.reverse === false)).toBe(true)
  })

  it('다음이 걸어서면 출구에서 바로', () => {
    const steps = buildDayRoute(
      [makeStop('k1', 'hanbat'), makeStop('k2', 'science', { arriveBy: 'walk' })],
      places,
    )
    expect(segmentIds(steps)).toEqual(['s1', 's2', 's3', 's4', 's5', 'c2', 'c3'])
    expect(segmentSteps(steps).every(step => step.reverse === false)).toBe(true)

    const [leg] = legSteps(steps)
    expect(leg.mode).toBe('walk')
    expect(leg.request?.from).toEqual({ placeId: 'hanbat', nodeId: 'X', coord: [127.3855, 36.3511] })
    expect(leg.request?.to).toEqual({ placeId: 'science', nodeId: 'E2', coord: [127.375, 36.374] })
  })

  it('빼기와 우회로', () => {
    const steps = buildDayRoute(
      [makeStop('k1', 'hanbat', { skipSegmentIds: ['s5'], detourMap: { s3: 's3d' } })],
      places,
    )
    expect(segmentIds(steps)).toEqual(['s1', 's2', 's3d', 's4'])
  })

  it('우회로 구간은 기본 경로에 없음', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat')], places)
    expect(segmentIds(steps)).not.toContain('s3d')
  })

  it('쉼터에서 쉬면 restAfter', () => {
    const steps = buildDayRoute([makeStop('k1', 'hanbat', { restNodeIds: ['R'] })], places)
    const segments = segmentSteps(steps)
    expect(segments.find(step => step.segment.id === 's2')?.restAfter).toBe(true)
    expect(segments.filter(step => step.segment.id !== 's2').every(step => step.restAfter === false)).toBe(true)
  })

  it('정보 없는 장소와 앉는 장소', () => {
    const steps = buildDayRoute(
      [makeStop('k1', null, { name: '점심', seated: true, coord: [127.39, 36.36] })],
      places,
    )
    expect(steps.map(step => step.kind)).toEqual(['unknown', 'seated'])
  })

  it('상세가 아직 없는 장소는 정보 없음', () => {
    const steps = buildDayRoute([makeStop('k1', 'museum')], places)
    expect(steps.map(step => step.kind)).toEqual(['unknown'])
  })

  it('좌표 없으면 경로 요청 없음', () => {
    const steps = buildDayRoute(
      [
        makeStop('k1', 'hanbat'),
        makeStop('k2', null, { name: '점심', arriveBy: 'walk' }),
        makeStop('k3', 'hanbat', { arriveBy: 'walk' }),
      ],
      places,
    )
    expect(legSteps(steps).map(step => step.request)).toEqual([null, null])
  })

  it('같은 장소를 두 번 가도 stop 기준으로 나뉨', () => {
    const steps = buildDayRoute(
      [makeStop('k1', 'hanbat'), makeStop('k2', 'science'), makeStop('k3', 'hanbat')],
      places,
    )
    const k1 = segmentSteps(steps).filter(step => step.stopKey === 'k1')
    const k3 = segmentSteps(steps).filter(step => step.stopKey === 'k3')
    // k1은 다음이 차라서 돌아가는 s1이 붙고, 마지막인 k3은 돌아가는 길이 없다.
    expect(k1.map(step => step.segment.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's1'])
    expect(k3.map(step => step.segment.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(k1.at(-1)?.reverse).toBe(true)
  })

  it('걸어서 들어오는 입구가 쉼터면 leg restAfter', () => {
    const steps = buildDayRoute(
      [makeStop('k1', 'science'), makeStop('k2', 'hanbat', { arriveBy: 'walk', restNodeIds: ['E'] })],
      places,
    )
    const [leg] = legSteps(steps)
    expect(leg.mode).toBe('walk')
    expect(leg.restAfter).toBe(true)
  })
})
