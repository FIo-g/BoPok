// AI가 쓴 글(장소 이름·메모·바뀐 점 한 줄)의 공용 검사 (설계 6.4).
// 숫자는 엔진 결과에만 있어야 하므로 전각·한글 수사까지 넓게 본다.
import 'server-only'
import type { FoodTag } from '@/lib/contracts'

export function normalizeAiText(s: string): string {
  return s.normalize('NFKC').trim()
}

// 한글 수사 + 단위 (explain에 있던 것을 공용으로 옮김)
const KOREAN_NUMBER_RE =
  /(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스물|스무|서른|마흔|쉰|일|이|삼|사|오|육|칠|팔|구|십|백)\s*(?:분|곳|칸|개|시간|번)/u

// 계단 표현 — 조사 뒤에 부사가 끼어도('계단을 모두 없앴어요') 약속 위반이므로 넓게 본다
const STAIRS_RE = /계단(?:이|을|도|은|는)?[\s\S]{0,20}?(?:없|사라|피했|안\s*나)/u

export function hasStairsClaim(s: string): boolean {
  return STAIRS_RE.test(normalizeAiText(s))
}

export function hasKoreanNumberClaim(s: string): boolean {
  return KOREAN_NUMBER_RE.test(normalizeAiText(s))
}

export function hasNumberOrStairsClaim(s: string): boolean {
  const norm = normalizeAiText(s)
  if (/\p{Nd}/u.test(norm)) return true
  if (KOREAN_NUMBER_RE.test(norm)) return true
  if (STAIRS_RE.test(norm)) return true
  return false
}

// 건강 상태를 짐작하는 낱말. AI가 "당뇨가 있으셔서…"처럼 쓰면, 프롬프트에 병 이름을 안 넣었어도
// 화면에 건강 이야기가 나온다. 건강 이야기는 주의 규칙 표의 근거 문장만 해야 하므로 AI 글에서는 버린다.
// '신장'은 키의 뜻도 있지만 AI 메모에는 필요 없는 말이라 넓게 막는다.
// '약을·약은·약이'는 앞에 한글이 없을 때만 본다 — '예약은 그대로'처럼 일정 메모에 흔한 말까지 버리지 않게.
const HEALTH_CLAIM_RE =
  /당뇨|혈당|혈압|고지혈|콜레스테롤|신장|콩팥|통풍|요산|심장|항응고|와파린|자몽|저염|싱겁|복용|지병|질환|(?<![가-힣])약(?:을|은|이)/u

export function hasHealthClaim(s: string): boolean {
  return HEALTH_CLAIM_RE.test(normalizeAiText(s))
}

// 프롬프트에 보낸 "피할 음식" 태그를 AI가 메모·식사 이름에 되풀이했는지 본다.
// 메모는 가족 모두가 보므로, "짠 음식을 피해 골랐어요"만으로도 "본인만"으로 둔 분의 식단 이유가 드러난다.
// 보낸 태그만 본다 — 보내지 않은 태그 이야기는 누구의 건강과도 이어지지 않는다.
// 술은 한 글자라 '미술관'·'기술'에 걸리지 않게 앞에 한글이 없을 때만 본다.
const FOOD_TAG_TALK_RE: Record<FoodTag, RegExp> = {
  sugary: /단\s*음식|당분|설탕|달지\s*않|덜\s*단|단\s*것/u,
  salty: /짠\s*음식|짜지\s*않|덜\s*짠|염분|나트륨|소금/u,
  fatty: /기름진|기름기|지방/u,
  alcohol: /(?<![가-힣])술|음주|주류/u,
  grapefruit: /자몽/u,
  leafy_greens: /잎채소|녹색\s*채소|채소/u,
}

export function mentionsFoodTags(s: string, tags: readonly FoodTag[]): boolean {
  const norm = normalizeAiText(s)
  return tags.some(tag => FOOD_TAG_TALK_RE[tag].test(norm))
}

// 가족 모두가 보는 AI 글(메모·DB에 없는 식사 자리 이름)에 건강·식단 이야기가 있는지 — 있으면 쓰지 않는다
export function hasDietTalk(s: string, tags: readonly FoodTag[]): boolean {
  return hasHealthClaim(s) || mentionsFoodTags(s, tags)
}

const NUMBER_PHRASE_RE =
  /(?<![\p{Nd}.~])\p{Nd}+(?:[.~]\p{Nd}+)*(?:\s*(?:분|곳|칸|개|시간))?(?![\p{Nd}~]|\.\p{Nd})/gu

export function numberPhrases(s: string): string[] {
  const norm = normalizeAiText(s)
  return norm.match(NUMBER_PHRASE_RE) ?? []
}

// 프롬프트에 넣기 전 의견·장소 이름 정리 — 줄바꿈·탭을 공백으로, 대괄호를 지운다
export function sanitizePromptText(s: string): string {
  return s
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
