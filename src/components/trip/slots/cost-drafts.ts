import type { Stop } from '@/lib/contracts'

export function costScope(tripId: string, versionId: string | null, day: number): string {
  return JSON.stringify([tripId, versionId, day])
}

function stopIdentity(stop: Stop) {
  // 같은 key를 유지한 채 장소를 교체해도 이전 장소의 금액은 이어받지 않는다.
  return [stop.key, stop.placeId, stop.coord ?? null, stop.placeId ? null : stop.name]
}

export function placeCostKey(scope: string, stop: Stop): string {
  return JSON.stringify([scope, 'place', stopIdentity(stop)])
}

export function taxiCostKey(scope: string, from: Stop, to: Stop, partySize: number): string {
  return JSON.stringify([scope, 'taxi', stopIdentity(from), stopIdentity(to), partySize,
    from.skipSegmentIds, from.detourMap, from.restNodeIds, to.skipSegmentIds, to.detourMap, to.restNodeIds])
}

export function applyUneditedQuotes<T>(current: Record<string, T>, requested: Record<string, T>, quotes: Record<string, T>): Record<string, T> {
  const next = { ...current }
  for (const [key, quote] of Object.entries(quotes)) {
    // 조회 중 직접 고친 금액·단위·수량은 늦게 도착한 응답으로 덮어쓰지 않는다.
    if (current[key] === requested[key]) next[key] = quote
  }
  return next
}
