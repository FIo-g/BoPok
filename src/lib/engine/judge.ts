// 하루 일정 판정 (설계 7.3, 노션 4-2·4-4). 걷는 시간·계단 수·판정은 여기서만 만든다.
// AI는 이 결과의 숫자만 문장에 쓸 수 있다.
import type {
  JudgeInput,
  JudgeResult,
  LegResult,
  MissingLeg,
  Minutes,
  PlaceDetail,
  PlaceSegment,
  SegmentResult,
  StopResult,
  Violation,
} from '@/lib/contracts'
import { legKey as legKeyOf } from '@/lib/contracts'
import { buildDayRoute } from './route'
import { groupProfile } from './speed'
import { formatRange, toRange, walkMinutes } from './walk-time'

// 28.000000000004 같은 부동소수점 오차가 1분을 넘기지 않게 한다.
const EPS = 1e-9

type Run = {
  baseMin: number
  fromStopKey: string | null
  toStopKey: string | null
  items: (SegmentResult | LegResult)[]
}

type LongestRun = { base: number; high: number; fromStopKey: string | null; toStopKey: string | null }

type StairsMeta = { stopKey: string | null; fromStopKey: string | null; toStopKey: string | null }

function emptyRun(): Run {
  return { baseMin: 0, fromStopKey: null, toStopKey: null, items: [] }
}

function emptyLongest(): LongestRun {
  return { base: 0, high: 0, fromStopKey: null, toStopKey: null }
}

function nodeName(place: PlaceDetail, nodeId: string): string {
  return place.nodes.find(node => node.id === nodeId)?.name ?? nodeId
}

// 원형 오염(예: placeId 'constructor')을 피하려고 안전하게 찾는다.
function getPlace(places: Record<string, PlaceDetail>, placeId: string | null | undefined): PlaceDetail | undefined {
  if (placeId === null || placeId === undefined) return undefined
  return Object.hasOwn(places, placeId) ? places[placeId] : undefined
}

// reverse면 같은 구간을 거꾸로 걷는 줄이라 출발·도착 이름도 바뀐다.
function segmentLabel(place: PlaceDetail, segment: PlaceSegment, reverse: boolean): string {
  const fromNodeId = reverse ? segment.toNodeId : segment.fromNodeId
  const toNodeId = reverse ? segment.fromNodeId : segment.toNodeId
  return `${nodeName(place, fromNodeId)} → ${nodeName(place, toNodeId)}`
}

export function judge(input: JudgeInput): JudgeResult {
  const profile = groupProfile(input.travelers, input.tuned)
  const condition = profile.condition
  const speedMps = profile.speedMps
  const steps = buildDayRoute(input.stops, input.places)

  const segmentsByStop = new Map<string, SegmentResult[]>()
  const legs: LegResult[] = []
  const violations: Violation[] = []
  const unknownStopKeys: string[] = []
  const unrecordedStairs: { segmentId?: string; legKey?: string }[] = []
  const missingLegs: MissingLeg[] = []
  let firstStairs: StairsMeta | null = null

  let dayBaseMin = 0
  let restTotalMin = 0
  let run = emptyRun()
  let longest = emptyLongest()
  // 들어갈 때·돌아갈 때 같은 구간을 두 번 걸어도 위반·기록 없음은 한 번만 넣는다. 걷는 시간은 두 번 센다.
  const seenStairsSegment = new Set<string>()
  const seenUnrecordedSegment = new Set<string>()
  const seenStairsLeg = new Set<string>()
  const seenUnrecordedLeg = new Set<string>()

  function addRunItem(
    fromStopKey: string,
    toStopKey: string,
    baseMin: number,
    item: SegmentResult | LegResult,
  ): void {
    if (run.fromStopKey === null) run.fromStopKey = fromStopKey
    run.toStopKey = toStopKey
    run.baseMin += baseMin
    run.items.push(item)
  }

  function spanRun(fromStopKey: string, toStopKey: string): void {
    if (run.fromStopKey === null) run.fromStopKey = fromStopKey
    run.toStopKey = toStopKey
  }

  function closeRun(): void {
    if (run.items.length === 0) {
      run = emptyRun()
      return
    }

    const high = toRange(run.baseMin).high
    if (run.baseMin > longest.base) {
      longest = { base: run.baseMin, high, fromStopKey: run.fromStopKey, toStopKey: run.toStopKey }
    }

    if (high > condition.continuousMin + EPS) {
      for (const item of run.items) item.status = 'warn'
    }

    run = emptyRun()
  }

  for (const step of steps) {
    if (step.kind === 'segment') {
      const place = getPlace(input.places, step.placeId)
      // buildDayRoute는 places에 있는 장소만 segment로 만든다.
      if (!place) continue

      const segment = step.segment
      const baseMin = walkMinutes(segment.distanceM, speedMps, {
        stairs: segment.stairsStatus === 'present',
        slope: segment.slope,
      })
      const stairViolation = segment.stairsStatus === 'present' && condition.avoidStairs
      const result: SegmentResult = {
        segmentId: segment.id,
        label: segmentLabel(place, segment, step.reverse),
        time: toRange(baseMin),
        reverse: step.reverse,
        stairsStatus: segment.stairsStatus,
        stairsCount: segment.stairsCount,
        status: stairViolation ? 'warn' : 'ok',
        source: segment.source,
        checkedAt: segment.checkedAt,
        confidence: segment.confidence,
      }

      if (stairViolation) {
        const key = `${step.stopKey}/${segment.id}`
        if (!seenStairsSegment.has(key)) {
          seenStairsSegment.add(key)
          violations.push({
            kind: 'stairs',
            stopKey: step.stopKey,
            segmentId: segment.id,
            count: segment.stairsCount,
          })
          if (firstStairs === null) {
            firstStairs = { stopKey: step.stopKey, fromStopKey: step.stopKey, toStopKey: step.stopKey }
          }
        }
      }
      if (segment.stairsStatus === 'unknown') {
        // 계단 피하기 여부와 상관없이 '기록 없는 구간'으로 모은다 (설계 8.3).
        if (!seenUnrecordedSegment.has(segment.id)) {
          seenUnrecordedSegment.add(segment.id)
          unrecordedStairs.push({ segmentId: segment.id })
        }
      }

      const stopSegments = segmentsByStop.get(step.stopKey) ?? []
      stopSegments.push(result)
      segmentsByStop.set(step.stopKey, stopSegments)

      dayBaseMin += baseMin
      addRunItem(step.stopKey, step.stopKey, baseMin, result)

      if (step.restAfter) {
        restTotalMin += condition.restMin
        closeRun()
      }
      continue
    }

    if (step.kind === 'leg') {
      const request = step.request
      const key = request === null ? null : legKeyOf(request)
      const leg = key === null ? undefined : input.legs[key]

      if (step.mode === 'walk') {
        if (key === null || leg === undefined) {
          // 없는 경로는 직선거리로 시간을 지어내지 않는다. 시간 0, 묶음은 이어 둔다.
          missingLegs.push({ fromStopKey: step.fromStopKey, toStopKey: step.toStopKey, legKey: key })
          spanRun(step.fromStopKey, step.toStopKey)
          // 걸어서 들어오는 입구가 쉼터면 경로가 없어도 쉴 수는 없으므로 묶음은 잇는다.
          // (request가 있어 경로가 판정된 뒤에만 쉼터에서 끊는다)
        } else {
          const baseMin = walkMinutes(leg.distanceM, speedMps, {
            stairs: leg.stairsStatus === 'present',
            slope: false,
          })
          const stairViolation = leg.stairsStatus === 'present' && condition.avoidStairs
          const result: LegResult = {
            legKey: key,
            fromStopKey: step.fromStopKey,
            toStopKey: step.toStopKey,
            mode: 'walk',
            walkTime: toRange(baseMin),
            rideMin: null,
            stairsStatus: leg.stairsStatus,
            status: stairViolation ? 'warn' : 'ok',
          }

          if (stairViolation) {
            if (!seenStairsLeg.has(key)) {
              seenStairsLeg.add(key)
              violations.push({
                kind: 'stairs',
                stopKey: null,
                legKey: key,
                count: leg.stairsCount,
              })
              if (firstStairs === null) {
                firstStairs = { stopKey: null, fromStopKey: step.fromStopKey, toStopKey: step.toStopKey }
              }
            }
          }
          if (leg.stairsStatus === 'unknown') {
            if (!seenUnrecordedLeg.has(key)) {
              seenUnrecordedLeg.add(key)
              unrecordedStairs.push({ legKey: key })
            }
          }

          legs.push(result)
          dayBaseMin += baseMin
          addRunItem(step.fromStopKey, step.toStopKey, baseMin, result)

          if (step.restAfter) {
            restTotalMin += condition.restMin
            closeRun()
          }
        }
        continue
      }

      // 탈것은 걷는 시간이 0으로 확실하므로 묶음을 끊고, 경로가 없어도 빠진 경로로 넣지 않는다.
      closeRun()
      if (key !== null) {
        legs.push({
          legKey: key,
          fromStopKey: step.fromStopKey,
          toStopKey: step.toStopKey,
          mode: step.mode,
          walkTime: null,
          rideMin: leg?.durationMin ?? null,
          stairsStatus: leg?.stairsStatus ?? 'unknown',
          status: 'ok',
        })
      }
      continue
    }

    if (step.kind === 'seated') {
      closeRun()
      continue
    }

    // 정보 없는 장소는 안쪽을 빼고 장소 사이 이동만 판정한다 (노션 4-4). 연속 걷기는 끊지 않는다.
    if (!unknownStopKeys.includes(step.stopKey)) unknownStopKeys.push(step.stopKey)
  }

  closeRun()

  const day = toRange(dayBaseMin)
  const continuousHigh = longest.high
  if (
    longest.fromStopKey !== null &&
    longest.toStopKey !== null &&
    continuousHigh > condition.continuousMin + EPS
  ) {
    violations.push({
      kind: 'continuous',
      fromStopKey: longest.fromStopKey,
      toStopKey: longest.toStopKey,
      over: continuousHigh - condition.continuousMin,
    })
  }
  if (day.high > condition.dayMin + EPS) {
    violations.push({ kind: 'day', over: day.high - condition.dayMin })
  }

  const stopName = (stopKey: string | null): string => {
    if (stopKey === null) return ''
    return input.stops.find(stop => stop.key === stopKey)?.name ?? stopKey
  }

  const hasEmptyStops = input.stops.length === 0
  const verdict =
    hasEmptyStops
      ? 'info'
      : violations.length > 0
        ? 'adjust'
        : unknownStopKeys.length > 0 || missingLegs.length > 0
          ? 'info'
          : 'ok'

  const reason = (): string => {
    if (hasEmptyStops) return '일정에 장소가 아직 없어요'

    if (firstStairs !== null) {
      if (firstStairs.stopKey !== null) {
        return `${stopName(firstStairs.stopKey)} 안에 계단 구간이 있어요`
      }
      return `${stopName(firstStairs.fromStopKey)}에서 ${stopName(firstStairs.toStopKey)} 가는 길에 계단이 있어요`
    }

    const continuous = violations.find(violation => violation.kind === 'continuous')
    const dayViolation = violations.find(violation => violation.kind === 'day')
    // 노션 4-2: 넘은 분이 큰 위반을 말한다. 같으면 연속 걷기를 먼저.
    if (continuous !== undefined && (dayViolation === undefined || continuous.over >= dayViolation.over)) {
      const longestRange: Minutes = { base: longest.base, high: longest.high }
      const samePlace =
        longest.fromStopKey !== null &&
        longest.fromStopKey === longest.toStopKey
      return samePlace
        ? `${stopName(longest.fromStopKey)} 안에서 쉬지 않고 ${formatRange(longestRange)}을 걸어야 해요 (조건 ${condition.continuousMin}분)`
        : `${stopName(longest.fromStopKey)}에서 ${stopName(longest.toStopKey)}까지 쉬지 않고 ${formatRange(longestRange)}을 걸어야 해요 (조건 ${condition.continuousMin}분)`
    }
    if (dayViolation !== undefined) {
      return `하루 동안 모두 ${formatRange(day)}을 걸어야 해요 (조건 ${condition.dayMin}분)`
    }

    if (unknownStopKeys.length > 0) {
      const firstUnknown = stopName(unknownStopKeys[0])
      if (legs.some(leg => leg.mode === 'walk') && missingLegs.length === 0) {
        return `장소 사이 이동은 조건에 맞아요. ${firstUnknown} 안의 길은 아직 정보가 없어요`
      }
      return `${firstUnknown} 안의 길은 아직 정보가 없어요`
    }

    if (missingLegs.length > 0) {
      const firstMissing = missingLegs[0]
      return `${stopName(firstMissing.fromStopKey)}에서 ${stopName(firstMissing.toStopKey)} 가는 길 정보를 아직 받지 못했어요`
    }

    if (condition.avoidStairs && unrecordedStairs.length > 0) {
      return `모든 구간이 부모님 조건에 맞아요. 다만 계단 기록이 없는 구간이 ${unrecordedStairs.length}곳 있어요`
    }
    return '모든 구간이 부모님 조건에 맞아요'
  }

  const stopResults: StopResult[] = input.stops.map(stop => {
    const segments = segmentsByStop.get(stop.key) ?? []
    const walkBase = segments.reduce((sum, segment) => sum + segment.time.base, 0)
    const place = getPlace(input.places, stop.placeId)
    return {
      stopKey: stop.key,
      placeId: stop.placeId,
      known: place !== undefined && place.segments.length > 0,
      walk: toRange(walkBase),
      segments,
    }
  })

  return {
    verdict,
    reason: reason(),
    condition,
    conditionFrom: profile.conditionFrom,
    speedMps,
    speedTravelerId: profile.speedTravelerId,
    pendingConsents: profile.pendingConsents,
    day,
    longest,
    restTotalMin,
    stops: stopResults,
    legs,
    violations,
    unknownStopKeys,
    unrecordedStairs,
    missingLegs,
  }
}
