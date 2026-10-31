// 이동주 폴더(src/lib/places, src/lib/geo)에 아직 없는 AI용 함수를, 있는 함수를 조합해 AI 폴더 안에서 만든다.
// searchCandidates·matchPlaceByName은 listPlaces로, searchPoi는 TMAP POI 검색이 없어 항상 null이다.
// 숫자(걷는 시간·거리·계단)는 여기서 만들지 않는다 — 장소 요약에 없는 조건은 거르지 않고 그대로 둔다.
import 'server-only'
import type { Leg, LegRequest, PlaceDetail, PlaceSummary } from '@/lib/contracts'
import { PlaceIdInputSchema } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'
import type { LegsOutcome } from '@/lib/geo/legs'
import { getPlaceDetails, listPlaces } from '@/lib/places'
import type { AiDeps, CandidateQuery } from './deps'

// ---------- searchCandidates ----------

// 스타일이 맞는 장소를 앞에 두고, 나머지도 뒤에 붙인다. 장소가 아직 적어서 거르면 후보가 비기 쉽기 때문이다.
// 예산·이동수단·계단 피하기는 PlaceSummary에 없어 여기서 거르지 않는다 (계단은 엔진 판정이 본다).
// 같은 점수끼리는 listPlaces의 순서(이름, id)를 그대로 지킨다.
export function rankCandidates(all: PlaceSummary[], q: CandidateQuery): PlaceSummary[] {
  const wanted = new Set(q.styles.map(style => style.trim()).filter(style => style.length > 0))
  const score = (place: PlaceSummary): number => place.styles.filter(style => wanted.has(style)).length
  return all
    .map((place, index) => ({ place, index, score: score(place) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.place)
    .slice(0, Math.max(0, q.limit))
}

// ---------- matchPlaceByName ----------

// 공백을 없애고 소문자로 맞춘다 ("한밭 수목원" = "한밭수목원").
function normalizeName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

// 이름이 같거나, 입력 안에 장소 이름이 통째로 들어 있으면("한밭수목원 산책") 맞춘다.
// 비슷한 다른 장소로 잘못 맞추는 것보다 못 맞추는 편이 낫다(정보 없음으로 둔다) — 후보가 둘 이상이면 null.
// 입력이 장소 이름의 일부일 때("미술관")는 맞추지 않는다.
export function findPlaceByName(all: PlaceSummary[], name: string): PlaceSummary | null {
  const input = normalizeName(name)
  if (input.length === 0) return null
  const named = all.map(place => ({ place, key: normalizeName(place.name) })).filter(item => item.key.length >= 2)

  const exact = named.filter(item => item.key === input)
  if (exact.length > 0) return exact.length === 1 ? exact[0].place : null

  const contained = named.filter(item => input.includes(item.key)).sort((a, b) => b.key.length - a.key.length)
  if (contained.length === 0) return null
  // 가장 긴 이름이 둘 이상이면(길이가 같은 다른 장소) 어느 쪽인지 알 수 없다.
  if (contained.length > 1 && contained[0].key.length === contained[1].key.length) return null
  return contained[0].place
}

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

// ---------- 한데 묶기 ----------

export type PlaceAdapters = Pick<AiDeps, 'searchCandidates' | 'matchPlaceByName' | 'searchPoi'>

// listAll은 장소 전체 목록이다. 장소가 수백 곳을 넘으면 DB에서 거르도록 바꾼다(지금은 시범 장소뿐).
export function createPlaceAdapters(listAll: () => Promise<PlaceSummary[]> = () => listPlaces({})): PlaceAdapters {
  return {
    searchCandidates: async q => rankCandidates(await listAll(), q),
    matchPlaceByName: async name => findPlaceByName(await listAll(), name),
    // TMAP POI 검색이 아직 없다. null이면 붙여넣기 정리가 그 이름을 '정보 없음' 자리로 둔다(설계 6.4).
    searchPoi: async () => null,
  }
}
