// 랜드마크 상세 화면의 "이 장소로 일정 만들기": 첫 화면에서는 로그인·그룹 고르기를 거쳐야 새 여행을 만들 수 있어서,
// 고른 장소를 이 탭(sessionStorage)에 기억해 두었다가 새 여행의 "짜 둔 일정 붙여넣기" 칸에 한 줄로 넣어 준다.
export const PLACE_INTENT_KEY = 'bopok-place-intent'

// 붙여넣기 칸에 들어갈 한 줄. 시각은 하루의 시작으로 흔한 10:00 으로 두고 사용자가 고친다
export const scheduleLineForPlace = (name: string) => `10:00 ${name}`

export function rememberPlaceIntent(name: string): void {
  try {
    sessionStorage.setItem(PLACE_INTENT_KEY, name)
  } catch {}
}

// 지우지 않고 읽는다(개발 모드는 초기값 함수를 두 번 부르므로 읽으면서 지우면 두 번째가 비어 버린다). 없거나 저장소를 못 쓰면 null
export function peekPlaceIntent(): string | null {
  try {
    const name = sessionStorage.getItem(PLACE_INTENT_KEY)
    return name && name.trim() ? name.trim() : null
  } catch {
    return null
  }
}

// 새 여행 화면에 들어와 칸에 넣은 뒤 지운다(다음 새 여행에 또 들어가지 않게)
export function clearPlaceIntent(): void {
  try {
    sessionStorage.removeItem(PLACE_INTENT_KEY)
  } catch {}
}
