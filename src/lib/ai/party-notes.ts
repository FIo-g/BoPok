// 일정을 짜거나 다시 짤 때 AI에게 주는 일행 참고 줄 (generate·revise 공용).
// 건강 정보는 병·약 이름이 아니라 "피할 음식 태그의 한국어 이름"만 간다 — 누가·왜는 오지 않는다 (AGENTS 6장, 설계 4.4).
// 걷는 시간·판정은 엔진이 정하므로 이 줄은 식당 고르기와 쉬는 자리 참고용일 뿐이다.
import 'server-only'
import { FOOD_TAG_LABEL, type FoodTag, type Traveler } from '@/lib/contracts'
import type { AiDeps } from './deps'

// 피할 음식 태그를 읽는다. 읽기에 실패하면 태그 없이 계속한다 — 일정 만들기 전체를 막지 않는다
// (식단 주의 카드는 화면에서 따로 보인다).
// 로그에는 tripId만 남긴다. 에러 객체·메시지를 찍지 않는 까닭: DB 오류(DrizzleQueryError)의 메시지에
// 쿼리 값(병·약 종류)이 들어 있을 수 있다.
export async function readAvoidFoodTags(deps: Pick<AiDeps, 'getAvoidFoodTags'>, tripId: string): Promise<FoodTag[]> {
  try {
    return await deps.getAvoidFoodTags(tripId)
  } catch {
    console.warn('[ai] 피할 음식 태그를 못 읽었어요', { tripId })
    return []
  }
}

// 같은 태그가 겹쳐 와도 한 번만, 받은 순서를 지킨다. 태그가 없으면 줄 자체가 없다.
export function avoidFoodLine(tags: readonly FoodTag[]): string | null {
  const unique = [...new Set(tags)]
  if (unique.length === 0) return null
  return `피할 음식: ${unique.map(tag => FOOD_TAG_LABEL[tag]).join(', ')} — 이런 메뉴가 많은 식당은 고르지 마라.`
}

// 운동 횟수는 걷는 시간에 얼마나 영향을 주는지 근거 숫자가 아직 없다.
// 그래서 "더 쉬게" 쪽으로만 참고로 주고, 더 걷게 만드는 쪽으로는 쓰지 않는다. 이름표도 넣지 않는다.
export function exerciseLine(travelers: readonly Traveler[]): string | null {
  if (!travelers.some(traveler => traveler.exerciseFrequency === 'rarely')) return null
  return '운동을 거의 안 하는 분이 함께 간다 — 쉬는 자리를 자주 넣어라.'
}

export function partyNoteLines(tags: readonly FoodTag[], travelers: readonly Traveler[]): string[] {
  return [avoidFoodLine(tags), exerciseLine(travelers)].filter((line): line is string => line !== null)
}
