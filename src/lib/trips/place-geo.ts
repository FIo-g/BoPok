// 장소·경로 정보를 가져오는 지점. 실제 구현은 이동주 담당이고(src/lib/places, src/lib/geo)
// 여기서는 그 함수를 우리 쪽 모양으로 감싼다 (AGENTS.md 3·4장 — import만 한다).
import 'server-only'
import type { Leg, LegRequest, PlaceDetail } from '@/lib/contracts'
import { PlaceIdInputSchema } from '@/lib/contracts'
import { getLegsPartial } from '@/lib/geo/legs'
import { getPlaceDetails } from '@/lib/places'

export type PlaceGeoDeps = {
  getPlaceDetails(ids: string[]): Promise<PlaceDetail[]>
  getLegs(requests: LegRequest[]): Promise<Leg[]>
}

// src/lib/geo의 LegsInputSchema가 한 번에 20개까지만 받는다. 넘기면 요청 전체가 거절된다.
const LEGS_PER_CALL = 20

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

// 받은 경로만 돌려준다. 못 받은 구간은 넣지 않고, 엔진이 missingLegs('경로 정보 없음')로 처리한다 —
// 숫자를 지어내지 않는다 (AGENTS.md 6장).
async function fetchLegs(requests: LegRequest[]): Promise<Leg[]> {
  // src/lib/geo는 walk·car·taxi를 지원하고 bus는 아직 지원하지 않는다(구간별 '실패'로 돌아온다).
  // 그래서 버스만 빼고 보낸다 — 탈것 시간(durationMin)은 공유 글에 쓰인다.
  const routed = requests.filter(request => request.mode !== 'bus')
  if (routed.length === 0) return []

  const legs: Leg[] = []
  for (const part of chunk(routed, LEGS_PER_CALL)) {
    try {
      // getLegsPartial은 구간별 실패로는 던지지 않는다 (키 없음·TMAP 오류·시간 초과 등).
      const outcome = await getLegsPartial(part)
      legs.push(...outcome.legs)
      if (outcome.failed.length > 0) {
        console.error('[acct] 일부 경로를 받지 못했어요 (그 구간은 경로 정보 없음)', {
          failed: outcome.failed.map(one => ({ key: one.key, kind: one.error.kind })),
        })
      }
    } catch (error) {
      // 20개 초과·DB 오류 같은 배치 전체 오류. 판정은 그 구간들을 '정보 없음'으로 본다.
      console.error('[acct] 경로 요청이 실패했어요', error instanceof Error ? error.message : error)
    }
  }
  return legs
}

// 장소 상세는 한 번에 100개까지다(src/lib/places). 중복·형식이 틀린 id 하나 때문에
// 전체가 던지지 않게 먼저 거르고 나눠 부른다.
const PLACES_PER_CALL = 100

async function fetchPlaceDetails(ids: string[]): Promise<PlaceDetail[]> {
  const valid = [...new Set(ids)].filter(id => PlaceIdInputSchema.safeParse(id).success)
  const out: PlaceDetail[] = []
  for (const part of chunk(valid, PLACES_PER_CALL)) out.push(...(await getPlaceDetails(part)))
  return out
}

const realDeps: PlaceGeoDeps = {
  getPlaceDetails: fetchPlaceDetails,
  getLegs: fetchLegs,
}

// 테스트에서만 바꿔 끼운다. 실제 TMAP을 부르지 않기 위한 자리다
// (createVersion의 모양은 AI 계약이라 인자로 받을 수 없다).
let override: PlaceGeoDeps | null = null

export function setPlaceGeoDepsForTests(deps: PlaceGeoDeps | null): void {
  override = deps
}

export function getPlaceGeoDeps(): PlaceGeoDeps {
  return override ?? realDeps
}
