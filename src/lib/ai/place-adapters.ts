// 장소 상세·경로 어댑터. 이동주 함수(getPlaceDetails, getLegsPartial)를 AI 연결 지점 모양으로 맞춘다.
// 숫자(걷는 시간·거리·계단)는 여기서 만들지 않는다.
import 'server-only'
import type { Leg, LegRequest, PlaceDetail } from '@/lib/contracts'
import { PlaceIdInputSchema } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'
import type { LegsOutcome } from '@/lib/geo/legs'
import { getPlaceDetails } from '@/lib/places'
import type { AiDeps } from './deps'

// ---------- getPlaceDetails ----------

const MAX_DETAIL_IDS = 100 // getPlaceDetails의 상한

// 형식이 틀린 id 하나 때문에 조회 전체가 실패하지 않게 거른다. 없는 id를 빼는 getPlaceDetails의 규칙과 같다.
export function createPlaceDetailsAdapter(
  fetchDetails: (ids: string[]) => Promise<PlaceDetail[]> = ids => getPlaceDetails(ids),
): AiDeps['getPlaceDetails'] {
  return async ids => {
    const valid = [...new Set(ids)].filter(id => PlaceIdInputSchema.safeParse(id).success).slice(0, MAX_DETAIL_IDS)
    return valid.length === 0 ? [] : fetchDetails(valid)
  }
}

// ---------- getLegs ----------

const LEGS_PER_CALL = 20 // 경로 서비스가 한 번에 받는 상한

// 경로 서비스는 지금 걷는 길만 안다. 탈것 구간은 묻지 않는다 — 엔진이 시간 모름으로 다루고 숫자를 지어내지 않는다.
// 20개씩 나눠 묻고, 받지 못한 항목은 뺀다(엔진이 '경로 정보 없음'으로 판정). 입력이 잘못된 묶음(GeoError)만 건너뛴다.
export function createLegsAdapter(partial: (requests: LegRequest[]) => Promise<LegsOutcome>): AiDeps['getLegs'] {
  return async requests => {
    const walk = requests.filter(request => request.mode === 'walk')
    const legs: Leg[] = []
    const failedKinds: string[] = []
    for (let start = 0; start < walk.length; start += LEGS_PER_CALL) {
      try {
        const outcome = await partial(walk.slice(start, start + LEGS_PER_CALL))
        legs.push(...outcome.legs)
        failedKinds.push(...outcome.failed.map(item => item.error.kind))
      } catch (error) {
        if (!(error instanceof GeoError)) throw error
        failedKinds.push(error.kind)
      }
    }
    // 키·원문 없이 실패 종류만 남긴다.
    if (failedKinds.length > 0) console.error('[ai]', '경로 일부를 받지 못함', failedKinds.join(','))
    return legs
  }
}
