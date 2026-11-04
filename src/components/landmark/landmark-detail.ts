// 랜드마크 상세 화면의 상태 흐름(순수 함수). 연출 시간·카메라는 컴포넌트(useLandmarkDetail)가 맡고, 여기서는 "지금 어느 단계인지"와
// URL(?place=<id>) 읽기·쓰기, 닫는 키만 정한다.
//   closed → flying(카메라가 다가가는 중) → opening(화면이 막 올라옴) → open → closing(내려가며 흐려짐) → closed
export type DetailPhase = 'closed' | 'flying' | 'opening' | 'open' | 'closing'
export type DetailState = { id: string | null; phase: DetailPhase }
export type DetailEvent =
  | { type: 'select'; id: string }
  | { type: 'arrived' } // 카메라가 도착했다(150ms 뒤 화면이 올라온다)
  | { type: 'shown' } // 첫 프레임을 그려서 등장 전환을 시작한다
  | { type: 'close' } // X·ESC·바깥 클릭·뒤로가기
  | { type: 'closed' } // 내려가는 연출이 끝났다

export const CLOSED: DetailState = { id: null, phase: 'closed' }

export function detailReducer(state: DetailState, event: DetailEvent): DetailState {
  switch (event.type) {
    case 'select':
      // 이미 열려 있거나 닫는 중이면 다른 모형을 눌러도 무시한다(닫힌 뒤에만 새로 연다)
      return state.phase === 'closed' ? { id: event.id, phase: 'flying' } : state
    case 'arrived':
      return state.phase === 'flying' ? { ...state, phase: 'opening' } : state
    case 'shown':
      return state.phase === 'opening' ? { ...state, phase: 'open' } : state
    case 'close':
      return state.phase === 'closed' || state.phase === 'closing' ? state : { ...state, phase: 'closing' }
    case 'closed':
      return state.phase === 'closing' ? CLOSED : state
  }
}

export const isDetailVisible = (state: DetailState) => state.phase !== 'closed'

// ───────── URL 동기화 (?place=<id>) ─────────
export const PLACE_PARAM = 'place'

// 주소의 검색 부분("?a=1&place=x")에서 장소 id 를 읽는다. 알려진 id 가 아니면 null(엉뚱한 값으로 열리지 않게)
export function placeIdFromSearch(search: string, knownIds: readonly string[]): string | null {
  const id = new URLSearchParams(search).get(PLACE_PARAM)
  return id && knownIds.includes(id) ? id : null
}

// 다른 검색 값은 그대로 두고 place 만 넣거나(id) 뺀다(null). 결과는 "?..." 또는 빈 문자열
export function searchWithPlace(search: string, id: string | null): string {
  const params = new URLSearchParams(search)
  if (id) params.set(PLACE_PARAM, id)
  else params.delete(PLACE_PARAM)
  const text = params.toString()
  return text ? `?${text}` : ''
}

// 상세 화면에서 닫기로 치는 키
export const shouldCloseOnKey = (key: string) => key === 'Escape' || key === 'Esc'

// 모바일 시트를 아래로 끌어 닫는 기준(px)
export const SHEET_CLOSE_DRAG_PX = 80
export const shouldCloseSheet = (dragPx: number) => dragPx >= SHEET_CLOSE_DRAG_PX

// ───────── 설명의 출처 문구 (AGENTS.md 6장: 출처·확인 날짜·신뢰 등급을 항상 붙인다) ─────────
export const CONFIDENCE_LABEL = { A: '공식 안내·현장 확인', B: '지도에서 측정', C: '사진·후기로 추정' } as const

// "출처: {source} · {YYYY.MM} 확인 · 신뢰 C(사진·후기로 추정)". 출처나 날짜가 비었거나 형식이 틀리면 "출처 확인 중"
export function landmarkSourceText(l: { source: string; checkedAt: string; confidence: 'A' | 'B' | 'C' }): string {
  const m = l.checkedAt.match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/)
  const source = l.source.trim()
  if (!source || !m) return '출처 확인 중'
  return `출처: ${source} · ${m[1]}.${m[2]} 확인 · 신뢰 ${l.confidence}(${CONFIDENCE_LABEL[l.confidence]})`
}
