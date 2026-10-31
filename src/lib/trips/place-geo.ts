// 장소·경로 정보를 가져오는 지점. 이동주 담당(src/lib/places의 getPlaceDetails,
// src/lib/geo의 getLegs)이라 여기서는 모양만 정하고 주입한다 (AGENTS.md 3·4장).
//
// 그 API가 main에 오면 아래 getPlaceGeoDeps()의 두 줄만 바꿔 끼우면 된다:
//   import { getPlaceDetails } from '@/lib/places'
//   import { getLegs } from '@/lib/geo'
// 그때까지는 빈 배열을 돌려준다 — 판정은 '정보 없음'으로 나오고, 공유 글도 숫자를 지어내지 않는다.
import 'server-only'
import type { Leg, LegRequest, PlaceDetail } from '@/lib/contracts'

export type PlaceGeoDeps = {
  getPlaceDetails(ids: string[]): Promise<PlaceDetail[]>
  getLegs(requests: LegRequest[]): Promise<Leg[]>
}

// 장소 데이터가 아직 없는 동안 쓰는 임시 구현. 가짜 숫자를 만들지 않고 '없음'을 돌려준다.
const emptyDeps: PlaceGeoDeps = {
  getPlaceDetails: async () => [],
  getLegs: async () => [],
}

export function getPlaceGeoDeps(): PlaceGeoDeps {
  return emptyDeps
}
