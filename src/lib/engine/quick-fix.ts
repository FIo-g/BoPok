// 빠른 수정안 A·B·C (설계 7.4, 노션 4-3). 판정과 같은 엔진 숫자만 쓴다.
// A 동선 조정 → B 휴식 추가 → C 이동수단 변경. 위반이 처음 사라진 단계까지만 돌려준다.
import type {
  JudgeInput,
  JudgeResult,
  MissingLeg,
  PlaceDetail,
  QuickFix,
  QuickFixChange,
  Stop,
} from '@/lib/contracts'
import { judge } from './judge'
import { buildDayRoute } from './route'

const EPS = 1e-9

type RestCandidate = { index: number; stopKey: string; nodeId: string }

// 원형 오염(예: placeId 'constructor')을 피하려고 안전하게 찾는다.
function getPlace(places: Record<string, PlaceDetail>, placeId: string | null | undefined): PlaceDetail | undefined {
  if (placeId === null || placeId === undefined) return undefined
  return Object.hasOwn(places, placeId) ? places[placeId] : undefined
}

// 출발 지점(주차장·정류장)이 한쪽 끝이라도 닿는 구간인지. 우회로는 관람 구간에만 쓴다.
function isAccessSegment(place: PlaceDetail, fromNodeId: string, toNodeId: string): boolean {
  const kindOf = (nodeId: string): string | undefined =>
    place.nodes.find(node => node.id === nodeId)?.kind
  const from = kindOf(fromNodeId)
  const to = kindOf(toNodeId)
  return from === 'parking' || from === 'stop' || to === 'parking' || to === 'stop'
}

// 입력 stops를 바꾸지 않으려고 복사한다. quickFixes는 입력 객체를 절대 바꾸지 않는다.
function cloneStops(stops: Stop[]): Stop[] {
  return stops.map(stop => ({
    ...stop,
    skipSegmentIds: [...stop.skipSegmentIds],
    detourMap: { ...stop.detourMap },
    restNodeIds: [...stop.restNodeIds],
  }))
}

// 원래 없던 빠진 경로가 새로 생긴 단계는 '해결'로 보지 않는다 (설계 7.4 세부).
function isEnough(result: JudgeResult, baseMissing: MissingLeg[]): boolean {
  if (result.violations.length !== 0) return false
  return result.missingLegs.every(missing =>
    baseMissing.some(
      base =>
        base.legKey === missing.legKey &&
        base.fromStopKey === missing.fromStopKey &&
        base.toStopKey === missing.toStopKey,
    ),
  )
}

function makeFix(
  level: QuickFix['level'],
  stops: Stop[],
  input: JudgeInput,
  changes: QuickFixChange[],
  baseMissing: MissingLeg[],
): QuickFix {
  const result = judge({ ...input, stops })
  return { level, stops, result, enough: isEnough(result, baseMissing), changes }
}

// 조건을 넘은 시간의 합(연속+하루). C는 이 값이 줄어드는 곳만 택시로 바꾼다.
function overSum(result: JudgeResult): number {
  return (
    Math.max(0, result.longest.high - result.condition.continuousMin) +
    Math.max(0, result.day.high - result.condition.dayMin)
  )
}

// 계단 구간에 같은 장소의 우회로가 있으면 바꾼다. 계단 피하기일 때만 A에서 쓴다.
// 관람 구간에만 쓰고, 출발 지점 ↔ 입구 구간과 빼기 대상(optional)은 뺀다.
function addDetours(input: JudgeInput, stops: Stop[]): QuickFixChange[] {
  const indexByKey = new Map(input.stops.map((stop, index) => [stop.key, index]))
  const changes: QuickFixChange[] = []

  for (const step of buildDayRoute(input.stops, input.places)) {
    if (step.kind !== 'segment') continue
    const segment = step.segment
    if (segment.stairsStatus !== 'present') continue
    if (segment.optional) continue

    const place = getPlace(input.places, step.placeId)
    if (place === undefined) continue
    if (isAccessSegment(place, segment.fromNodeId, segment.toNodeId)) continue
    const detour = place.segments.find(candidate => candidate.detourOf === segment.id)
    if (detour === undefined) continue

    const index = indexByKey.get(step.stopKey)
    if (index === undefined) continue
    const stop = stops[index]
    if (stop.skipSegmentIds.includes(segment.id)) continue
    if (stop.detourMap[segment.id] !== undefined) continue

    stop.detourMap[segment.id] = detour.id
    changes.push({
      kind: 'detour',
      stopKey: stop.key,
      segmentId: segment.id,
      detourSegmentId: detour.id,
    })
  }

  return changes
}

// '선택' 구간은 아직 빼지 않은 것만 뺀다. 장소 안 정보가 있는 곳에서만.
function addSkips(input: JudgeInput, stops: Stop[]): QuickFixChange[] {
  const changes: QuickFixChange[] = []

  for (const stop of stops) {
    if (stop.placeId === null) continue
    const place = getPlace(input.places, stop.placeId)
    if (place === undefined || place.segments.length === 0) continue

    for (const segment of place.segments) {
      if (!segment.optional || stop.skipSegmentIds.includes(segment.id)) continue
      stop.skipSegmentIds.push(segment.id)
      changes.push({ kind: 'skip', stopKey: stop.key, segmentId: segment.id })
    }
  }

  return changes
}

function hasContinuous(result: JudgeResult): boolean {
  return result.violations.some(violation => violation.kind === 'continuous')
}

// 가장 긴 묶음 범위의 stop들에서 아직 쉬지 않은 쉼터 도착 노드를 경로 순서대로 모은다.
function restCandidates(
  stops: Stop[],
  places: Record<string, PlaceDetail>,
  result: JudgeResult,
): RestCandidate[] {
  const { fromStopKey, toStopKey } = result.longest
  if (fromStopKey === null || toStopKey === null) return []

  const fromIndex = stops.findIndex(stop => stop.key === fromStopKey)
  const toIndex = stops.findIndex(stop => stop.key === toStopKey)
  if (fromIndex < 0 || toIndex < 0) return []

  const start = Math.min(fromIndex, toIndex)
  const end = Math.max(fromIndex, toIndex)
  const seen = new Set<string>()
  const candidates: RestCandidate[] = []

  for (const step of buildDayRoute(stops, places)) {
    if (step.kind !== 'segment') continue
    const index = stops.findIndex(stop => stop.key === step.stopKey)
    if (index < start || index > end) continue

    const place = getPlace(places, step.placeId)
    if (place === undefined) continue
    const arrivalNodeId = step.reverse ? step.segment.fromNodeId : step.segment.toNodeId
    const node = place.nodes.find(candidate => candidate.id === arrivalNodeId)
    if (node === undefined || node.kind !== 'rest') continue

    const stop = stops[index]
    if (stop.restNodeIds.includes(node.id)) continue
    const key = `${stop.key}/${node.id}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ index, stopKey: stop.key, nodeId: node.id })
  }

  return candidates
}

function withRest(stops: Stop[], candidate: RestCandidate): Stop[] {
  return stops.map((stop, index) =>
    index === candidate.index
      ? { ...stop, restNodeIds: [...stop.restNodeIds, candidate.nodeId] }
      : stop,
  )
}

export function quickFixes(input: JudgeInput): QuickFix[] {
  const base = judge(input)
  if (base.verdict !== 'adjust') return []
  const baseMissing = base.missingLegs

  const fixes: QuickFix[] = []

  // A: 계단 우회로(계단 피하기일 때만) + 선택 구간 빼기
  const stopsA = cloneStops(input.stops)
  const changesA: QuickFixChange[] = []
  if (base.condition.avoidStairs) changesA.push(...addDetours(input, stopsA))
  changesA.push(...addSkips(input, stopsA))

  let stageStops = stopsA
  let stageChanges = changesA
  const fixA = makeFix('A', stopsA, input, changesA, baseMissing)
  let stageResult = fixA.result

  if (changesA.length > 0) {
    fixes.push(fixA)
    if (fixA.enough) return fixes
  }

  // B: A + 가장 긴 묶음을 끊는 쉼터. 연속 위반이 있거나 더 줄어들 때만 넣는다.
  const stopsB = cloneStops(stageStops)
  const changesB = [...stageChanges]
  let resultB = stageResult

  while (hasContinuous(resultB)) {
    const candidates = restCandidates(stopsB, input.places, resultB)
    if (candidates.length === 0) break

    let best: { candidate: RestCandidate; result: JudgeResult } | null = null
    for (const candidate of candidates) {
      const trial = withRest(stopsB, candidate)
      const result = judge({ ...input, stops: trial })
      // 같으면 경로에서 먼저 나온 후보를 쓴다 (후보가 이미 경로 순서).
      if (best === null || result.longest.base < best.result.longest.base - EPS) {
        best = { candidate, result }
      }
    }

    if (best === null || best.result.longest.base >= resultB.longest.base - EPS) break

    stopsB.splice(0, stopsB.length, ...withRest(stopsB, best.candidate))
    changesB.push({ kind: 'rest', stopKey: best.candidate.stopKey, nodeId: best.candidate.nodeId })
    resultB = best.result
  }

  if (changesB.length > stageChanges.length) {
    stageStops = stopsB
    stageChanges = changesB
    const fixB = makeFix('B', stopsB, input, changesB, baseMissing)
    stageResult = fixB.result
    fixes.push(fixB)
    if (fixB.enough) return fixes
  }

  // C: B + stops[1..]의 걷기 leg를 경로 순서대로 한 곳씩 택시로 바꿔 본다.
  // 택시를 타러 주차장까지 걸어가야 해서 오히려 더 걸릴 수 있으므로,
  // 넘은 합이 줄어드는 곳만 바꾸고(줄면 그 상태에서 다음 곳을 시도),
  // 바뀐 곳이 없으면 C를 내지 않는다.
  const stopsC = cloneStops(stageStops)
  const changesC = [...stageChanges]
  let currentOver = overSum(stageResult)

  stopsC.forEach((stop, index) => {
    if (index === 0 || stop.arriveBy !== 'walk') return
    const trial = cloneStops(stopsC)
    trial[index] = { ...trial[index], arriveBy: 'taxi' }
    const result = judge({ ...input, stops: trial })
    if (overSum(result) < currentOver - EPS) {
      stopsC[index] = { ...stopsC[index], arriveBy: 'taxi' }
      changesC.push({ kind: 'taxi', toStopKey: stop.key })
      currentOver = overSum(result)
    }
  })

  if (changesC.length > stageChanges.length) {
    fixes.push(makeFix('C', stopsC, input, changesC, baseMissing))
  }

  return fixes
}
