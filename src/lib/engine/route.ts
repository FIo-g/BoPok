// 하루 경로 이어 붙이기 (설계 7.3 1번, 7.3.1). 장소 안 경로와 장소 사이 이동을 일정 순서대로 만든다.
// 좌표가 없으면 경로를 지어내지 않고 request를 비운다 (설계 7.3 7번).
import type {
  Coord,
  LegEnd,
  LegRequest,
  PlaceDetail,
  PlaceNode,
  PlaceSegment,
  Stop,
  Transport,
} from '@/lib/contracts'
import { startNodeKind } from './walk-time'

export type RouteStep =
  | { kind: 'segment'; stopKey: string; placeId: string; segment: PlaceSegment; reverse: boolean; restAfter: boolean }
  | { kind: 'leg'; fromStopKey: string; toStopKey: string; mode: Transport; request: LegRequest | null; restAfter: boolean }
  | { kind: 'seated'; stopKey: string } // 앉아서 머무는 장소 → 연속 걷기 끊김
  | { kind: 'unknown'; stopKey: string } // 장소 안 길 정보 없음

type AccessKind = 'parking' | 'stop'

// 원형 오염(예: placeId 'constructor')을 피하려고 안전하게 찾는다.
function getPlace(places: Record<string, PlaceDetail>, placeId: string | null | undefined): PlaceDetail | undefined {
  if (placeId === null || placeId === undefined) return undefined
  return Object.hasOwn(places, placeId) ? places[placeId] : undefined
}

function nodeById(place: PlaceDetail, nodeId: string): PlaceNode | undefined {
  return place.nodes.find(node => node.id === nodeId)
}

function isAccessNode(place: PlaceDetail, nodeId: string): boolean {
  const kind = nodeById(place, nodeId)?.kind
  return kind === 'parking' || kind === 'stop'
}

// 이동수단에 맞는 출발 지점 구간. 없으면 다른 출발 지점(주차장 ↔ 정류장)을 쓴다 (설계 7.3.1).
function accessSegment(place: PlaceDetail, kind: AccessKind): PlaceSegment | undefined {
  const matching = (wanted: AccessKind): PlaceSegment | undefined =>
    place.segments
      .filter(
        segment =>
          nodeById(place, segment.fromNodeId)?.kind === wanted &&
          nodeById(place, segment.toNodeId)?.kind === 'entrance',
      )
      .reduce<PlaceSegment | undefined>(
        (best, segment) => (best === undefined || segment.order < best.order ? segment : best),
        undefined,
      )

  return matching(kind) ?? matching(kind === 'parking' ? 'stop' : 'parking')
}

function entranceNode(place: PlaceDetail): PlaceNode | undefined {
  return place.nodes.find(node => node.kind === 'entrance')
}

function exitNode(place: PlaceDetail): PlaceNode | undefined {
  return place.nodes.find(node => node.kind === 'exit')
}

// 관람 구간: 양 끝이 출발 지점이 아니고 우회로가 아닌 구간. 빼기·우회로를 적용한 뒤 order 순서.
function tourSegments(place: PlaceDetail, stop: Stop): PlaceSegment[] {
  const byId = new Map(place.segments.map(segment => [segment.id, segment]))
  return place.segments
    .filter(
      segment =>
        segment.detourOf === undefined &&
        !isAccessNode(place, segment.fromNodeId) &&
        !isAccessNode(place, segment.toNodeId),
    )
    .sort((a, b) => a.order - b.order)
    .flatMap(segment => {
      if (stop.skipSegmentIds.includes(segment.id)) return []
      const detourId = stop.detourMap[segment.id]
      // 우회로 id가 이 장소에 없으면 원래 구간을 그대로 쓴다.
      return [detourId === undefined ? segment : (byId.get(detourId) ?? segment)]
    })
}

function tourArrivalNode(place: PlaceDetail, tour: PlaceSegment[]): PlaceNode | undefined {
  const last = tour[tour.length - 1]
  return last ? nodeById(place, last.toNodeId) : undefined
}

// 장소를 떠날 때의 좌표. 탈것이면 돌아간 출발 지점, 걷기면 출구 → 마지막 관람 구간 도착 → 입구.
function departureNode(
  place: PlaceDetail,
  tour: PlaceSegment[],
  returnAccess: PlaceSegment | undefined,
  mode: Transport,
): PlaceNode | undefined {
  const kind = startNodeKind(mode)
  if (kind) {
    const node = returnAccess ? nodeById(place, returnAccess.fromNodeId) : undefined
    if (node) return node
  } else {
    const exit = exitNode(place)
    if (exit) return exit
  }
  return tourArrivalNode(place, tour) ?? entranceNode(place)
}

// 다음 장소에 닿는 좌표. 탈것이면 그 이동수단의 출발 지점, 걷기면 입구 (설계 7.3.1).
function arrivalNode(place: PlaceDetail, mode: Transport): PlaceNode | undefined {
  const kind = startNodeKind(mode)
  if (kind) {
    const access = accessSegment(place, kind)
    const node = access ? nodeById(place, access.fromNodeId) : undefined
    if (node) return node
  }
  return entranceNode(place)
}

function nodeEnd(place: PlaceDetail, node: PlaceNode): LegEnd {
  return { placeId: place.id, nodeId: node.id, coord: node.coord }
}

function coordEnd(coord: Coord | undefined): LegEnd | null {
  return coord === undefined ? null : { coord }
}

function legRequest(
  stop: Stop,
  place: PlaceDetail | undefined,
  tour: PlaceSegment[],
  returnAccess: PlaceSegment | undefined,
  next: Stop,
  places: Record<string, PlaceDetail>,
): LegRequest | null {
  const mode = next.arriveBy

  let from: LegEnd | null
  if (place) {
    const node = departureNode(place, tour, returnAccess, mode)
    from = node ? nodeEnd(place, node) : coordEnd(stop.coord ?? place.coord)
  } else {
    from = coordEnd(stop.coord)
  }

  const nextPlace = getPlace(places, next.placeId)
  let to: LegEnd | null
  if (nextPlace) {
    const node = arrivalNode(nextPlace, mode)
    to = node ? nodeEnd(nextPlace, node) : coordEnd(next.coord ?? nextPlace.coord)
  } else {
    to = coordEnd(next.coord)
  }

  if (!from || !to) return null
  return { from, to, mode }
}

function segmentStep(
  stop: Stop,
  place: PlaceDetail,
  segment: PlaceSegment,
  reverse: boolean,
): RouteStep {
  const arrivalNodeId = reverse ? segment.fromNodeId : segment.toNodeId
  return {
    kind: 'segment',
    stopKey: stop.key,
    placeId: place.id,
    segment,
    reverse,
    restAfter: stop.restNodeIds.includes(arrivalNodeId),
  }
}

export function buildDayRoute(stops: Stop[], places: Record<string, PlaceDetail>): RouteStep[] {
  const steps: RouteStep[] = []

  stops.forEach((stop, index) => {
    const place = getPlace(places, stop.placeId)
    const known = place !== undefined && place.segments.length > 0
    const seated = place?.seated ?? stop.seated ?? false

    let tour: PlaceSegment[] = []
    if (known && place) {
      const arriveKind = startNodeKind(stop.arriveBy)
      if (arriveKind) {
        const access = accessSegment(place, arriveKind)
        if (access) steps.push(segmentStep(stop, place, access, false))
      }
      tour = tourSegments(place, stop)
      for (const segment of tour) steps.push(segmentStep(stop, place, segment, false))
    } else {
      // 상세가 없으면 판정을 멈추지 않고 '정보 없음'으로 넘긴다 (설계 7.3 6번).
      steps.push({ kind: 'unknown', stopKey: stop.key })
    }

    if (seated) steps.push({ kind: 'seated', stopKey: stop.key })

    const next = stops[index + 1]
    if (!next) return

    let returnAccess: PlaceSegment | undefined
    if (known && place) {
      const nextKind = startNodeKind(next.arriveBy)
      if (nextKind) {
        const access = accessSegment(place, nextKind)
        // 마지막 장소가 아니므로 탈것으로 떠날 때는 출발 지점까지 돌아가는 길을 센다.
        if (access) {
          returnAccess = access
          steps.push(segmentStep(stop, place, access, true))
        }
      }
    }

    steps.push({
      kind: 'leg',
      fromStopKey: stop.key,
      toStopKey: next.key,
      mode: next.arriveBy,
      request: legRequest(stop, place, tour, returnAccess, next, places),
      // 걸어서 들어오는 입구가 쉬기로 한 쉼터면 거기서 쉰 것으로 본다 (설계 7.3.1).
      restAfter:
        next.arriveBy === 'walk' &&
        (() => {
          const nextPlace = getPlace(places, next.placeId)
          if (!nextPlace) return false
          const arrival = arrivalNode(nextPlace, next.arriveBy)
          return arrival !== undefined && next.restNodeIds.includes(arrival.id)
        })(),
    })
  })

  return steps
}
