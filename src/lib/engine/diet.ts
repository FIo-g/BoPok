// 식단 주의 계산 (설계 4.4). 일정의 장소 메뉴 × 여행자의 병·약 × 규칙 표가 맞는 줄만 주의로 돌려준다.
// 띄우되 막지 않는다: 이 함수는 판정(judge)에 영향을 주지 않고, 규칙 표에 없는 조합은 아무 말도 하지 않는다.
// 숫자나 AI 문장은 만들지 않는다 — 문장·출처·확인 날짜는 규칙 표의 것을 그대로 옮긴다.
import type { DietCaution, DietRule, FoodTag, PlaceDetail, Stop, TravelerHealth } from '@/lib/contracts'
import { HEALTH_CONDITION_LABEL, MEDICATION_CLASS_LABEL } from '@/lib/contracts'

export interface DietCautionsInput {
  health: TravelerHealth[]
  stops: Stop[]
  places: Record<string, PlaceDetail>
  rules: readonly DietRule[]
}

// 이 사람의 병·약에 걸리는 규칙만 골라, 화면에 보일 이유(한국어 이름)를 붙인다. 규칙 표의 순서를 지킨다.
function matchingRules(health: TravelerHealth, rules: readonly DietRule[]): { rule: DietRule; reason: string }[] {
  const matches: { rule: DietRule; reason: string }[] = []
  for (const rule of rules) {
    if (rule.reasonKind === 'condition') {
      if (health.conditions.includes(rule.condition)) {
        matches.push({ rule, reason: HEALTH_CONDITION_LABEL[rule.condition] })
      }
    } else if (health.medicationClasses.includes(rule.medicationClass)) {
      matches.push({ rule, reason: MEDICATION_CLASS_LABEL[rule.medicationClass] })
    }
  }
  return matches
}

// 코드 단위 순서로 비교한다. localeCompare는 실행 환경의 언어 설정에 따라 순서가 달라질 수 있어 쓰지 않는다.
function byTravelerId(a: TravelerHealth, b: TravelerHealth): number {
  if (a.travelerId < b.travelerId) return -1
  return a.travelerId > b.travelerId ? 1 : 0
}

// 건강 정보를 가진 사람마다 일정의 메뉴를 규칙 표와 맞춰 본다.
// 받는 `health`는 서버가 보는 사람에게 canSeeHealth로 이미 걸러서 내려준 것이어야 한다. 이 함수는 보이는 범위를 모르고
// 받은 것을 전부 계산하므로, 걸러지지 않은 목록을 넘기면 "본인만" 정보가 다른 가족 화면에 새어 나간다.
// (일행 전체를 보는 avoidFoodTags는 사람·이유를 빼고 태그만 내는 서버의 AI 경로에서만 쓴다.)
export function dietCautions(input: DietCautionsInput): DietCaution[] {
  const { stops, places, rules } = input
  if (rules.length === 0 || input.health.length === 0) return []

  // 사람별 규칙은 한 번만 찾는다. 입력 배열은 건드리지 않고 복사해서 정렬한다.
  const travelers = [...input.health].sort(byTravelerId).map((health) => ({
    travelerId: health.travelerId,
    matches: matchingRules(health, rules),
  }))

  const cautions: DietCaution[] = []
  const seen = new Set<string>()

  for (const stop of stops) {
    if (stop.placeId === null) continue
    // places는 일반 객체라 'constructor' 같은 이름이 상속 속성으로 잡히지 않게 자기 키만 본다.
    const place = Object.hasOwn(places, stop.placeId) ? places[stop.placeId] : undefined
    if (!place?.menus) continue

    for (const menu of place.menus) {
      for (const traveler of travelers) {
        for (const foodTag of menu.foodTags) {
          for (const { rule, reason } of traveler.matches) {
            if (rule.foodTag !== foodTag) continue
            // 같은 (장소, 메뉴, 태그, 사람, 이유)는 한 줄만. 규칙이 겹치면 표에서 먼저 나온 것을 쓴다.
            // JSON 배열로 묶어 이름에 구분 문자가 들어 있어도 서로 다른 키가 섞이지 않게 한다.
            const key = JSON.stringify([stop.key, menu.name, foodTag, traveler.travelerId, reason])
            if (seen.has(key)) continue
            seen.add(key)
            cautions.push({
              stopKey: stop.key,
              menuName: menu.name,
              foodTag,
              travelerId: traveler.travelerId,
              reasonKind: rule.reasonKind,
              reason,
              sentence: rule.sentence,
              source: rule.source,
              checkedAt: rule.checkedAt,
            })
          }
        }
      }
    }
  }
  return cautions
}

// 일행 전체의 병·약에 걸리는 음식 태그. AI 프롬프트에는 "누가 왜"를 빼고 태그만 넘긴다(건강 정보 보호).
// 보이는 범위와 상관없이 일행 전체를 보므로 화면용 주의 계산에 쓰지 않는다 — 서버의 AI 경로 전용이다.
// 이름순으로 정렬해 같은 입력이면 항상 같은 순서가 된다.
export function avoidFoodTags(health: TravelerHealth[], rules: readonly DietRule[]): FoodTag[] {
  const tags = new Set<FoodTag>()
  for (const person of health) {
    for (const { rule } of matchingRules(person, rules)) tags.add(rule.foodTag)
  }
  return [...tags].sort()
}
