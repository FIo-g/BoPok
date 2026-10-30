// 경로 API에 한 번에 물어볼 장소 사이 이동 (설계 7.3 1번·7번).
import type { LegRequest, PlaceDetail, Stop } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { buildDayRoute } from './route'

// 같은 경로(legKey)는 처음 한 번만, 경로에 나온 순서대로.
export function requiredLegs(stops: Stop[], places: Record<string, PlaceDetail>): LegRequest[] {
  const seen = new Set<string>()
  const requests: LegRequest[] = []

  for (const step of buildDayRoute(stops, places)) {
    if (step.kind !== 'leg' || step.request === null) continue
    const key = legKey(step.request)
    if (seen.has(key)) continue
    seen.add(key)
    requests.push(step.request)
  }

  return requests
}
