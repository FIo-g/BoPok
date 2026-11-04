// 일정 화면 "식단 주의" 카드가 무엇을 보여 줄지 가르는 순수 도우미 (React·fetch 없음).
// 주의 계산은 엔진(dietCautions)이 하고, 여기서는 화면에 맞는 이름·한국어 태그를 붙이고 "무엇을 말할 수 있는지"만 가른다.
// 건강 값은 민감정보라서 이 파일 어디에서도 로그를 남기지 않는다.
import type { DietRule, PlaceDetail, Stop, Traveler, TravelerHealth } from '@/lib/contracts'
import { FOOD_TAG_LABEL, placeKindOf } from '@/lib/contracts'
import { dietCautions } from '@/lib/engine'

// 이름표를 못 찾을 때 쓰는 말. 건강 정보를 가진 사람이 목록에서 빠졌어도 줄은 그대로 보여 준다.
const UNKNOWN_TRAVELER_LABEL = '함께 가는 분'

export type HealthCautionRow = {
  stopKey: string
  placeName: string // stops의 name (없으면 places의 name)
  menuName?: string
  foodTagLabel: string // FOOD_TAG_LABEL
  travelerLabel: string // travelers에서 travelerId로 찾은 label, 못 찾으면 '함께 가는 분'
  reason: string
  sentence: string // 규칙 표 문장 그대로
  source: string
  checkedAt: string
  // 칼슘채널차단제는 약마다 자몽 영향이 달라서 "일부 약만 해당"이라고 한 줄을 더 보인다 (근거 노트의 단서)
  partialMedication: boolean
}

export type HealthSlotView =
  | { kind: 'hidden' } // 받은 건강 정보가 없다 → 아무것도 그리지 않는다
  | { kind: 'no_menus' } // 건강 정보는 있는데 그날 장소에 음식 종류(태그)가 붙은 메뉴가 하나도 없다
  // 메뉴는 있는데 규칙 표에 맞는 조합이 없다. uncheckedMeals는 메뉴·음식 종류 정보가 없어 확인하지 못한 식사 자리 이름이다
  | { kind: 'no_cautions'; uncheckedMeals: string[] }
  | { kind: 'cautions'; rows: HealthCautionRow[]; uncheckedMeals: string[] }

// places는 일반 객체라 'constructor' 같은 이름이 상속 속성으로 잡히지 않게 자기 키만 본다 (엔진과 같은 이유).
function placeOf(places: Record<string, PlaceDetail>, placeId: string | null): PlaceDetail | undefined {
  if (placeId === null) return undefined
  return Object.hasOwn(places, placeId) ? places[placeId] : undefined
}

// 음식 태그가 빈 메뉴는 "주의할 음식이 없다"가 아니라 "아직 음식 종류를 확인하지 않았다"이다.
// 수집한 식당·카페 메뉴(이름·가격만)가 모두 그렇다. 태그가 있는 메뉴만 확인한 것으로 센다.
function hasTaggedMenu(place: PlaceDetail | undefined): boolean {
  return (place?.menus ?? []).some(menu => menu.foodTags.length > 0)
}

function allMenusTagged(place: PlaceDetail | undefined): boolean {
  const menus = place?.menus ?? []
  return menus.length > 0 && menus.every(menu => menu.foodTags.length > 0)
}

// 확인하지 못한 식사 자리: 식당·카페인데 메뉴가 없거나 음식 태그가 빈 메뉴가 있는 곳, 또는 장소 DB에 없는 식사(placeId null + seated).
// 관광지는 메뉴가 없는 것이 당연해서 넣지 않는다. 이런 곳이 있으면 "주의 없음"이 그날 전체를 확인했다는 뜻이 아니게 된다.
function uncheckedMealNames(stops: Stop[], places: Record<string, PlaceDetail>): string[] {
  const names: string[] = []
  for (const stop of stops) {
    const place = placeOf(places, stop.placeId)
    if (allMenusTagged(place)) continue
    const isMeal = place ? placeKindOf(place) === 'restaurant' || placeKindOf(place) === 'cafe' : stop.placeId === null && stop.seated === true
    if (isMeal) names.push(stop.name)
  }
  return names
}

// `health`는 서버가 보는 사람에게 canSeeHealth로 이미 거른 목록이어야 한다. 비어 있으면 hidden이다 —
// "본인만"으로 둔 가족의 화면에는 건강 정보가 있다는 사실조차 비치지 않는다.
export function healthSlotView(args: {
  health: TravelerHealth[]
  stops: Stop[]
  places: Record<string, PlaceDetail>
  travelers: Traveler[]
  rules: readonly DietRule[]
}): HealthSlotView {
  const { health, stops, places, travelers, rules } = args
  if (health.length === 0) return { kind: 'hidden' }

  // 음식 종류가 확인된 메뉴가 하나도 없으면 "주의 없음"이 아니라 "확인하지 못함"이다. 근거 없이 괜찮다고 말하지 않는다.
  const hasMenus = stops.some(stop => hasTaggedMenu(placeOf(places, stop.placeId)))
  if (!hasMenus) return { kind: 'no_menus' }

  const cautions = dietCautions({ health, stops, places, rules })
  const uncheckedMeals = uncheckedMealNames(stops, places)
  if (cautions.length === 0) return { kind: 'no_cautions', uncheckedMeals }

  const rows = cautions.map((caution): HealthCautionRow => {
    const stop = stops.find(item => item.key === caution.stopKey)
    const traveler = travelers.find(item => item.id === caution.travelerId)
    return {
      stopKey: caution.stopKey,
      placeName: stop?.name ?? placeOf(places, stop?.placeId ?? null)?.name ?? '이 장소',
      menuName: caution.menuName,
      foodTagLabel: FOOD_TAG_LABEL[caution.foodTag],
      travelerLabel: traveler?.label ?? UNKNOWN_TRAVELER_LABEL,
      reason: caution.reason,
      sentence: caution.sentence,
      source: caution.source,
      checkedAt: caution.checkedAt,
      partialMedication: caution.reasonKind === 'medication' && caution.foodTag === 'grapefruit',
    }
  })
  return { kind: 'cautions', rows, uncheckedMeals }
}
