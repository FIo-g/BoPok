// AI가 쓴 글(장소 이름·메모·바뀐 점 한 줄)의 공용 검사 (설계 6.4).
// 숫자는 엔진 결과에만 있어야 하므로 전각·한글 수사까지 넓게 본다.
import 'server-only'

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
