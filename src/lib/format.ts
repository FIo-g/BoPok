// 화면에 보이는 문장을 만드는 작은 함수들. 판정·걷는 시간 숫자는 만들지 않고 엔진 결과를 글로만 바꾼다.
import type { Confidence, JudgeResult, LegResult, Minutes, Reaction, SegmentResult, StairsStatus, Transport, User, Verdict, VersionSummary } from '@/lib/contracts'
import { formatRange } from '@/lib/engine'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

// '2026-11-14' → '2026년 11월 14일 (토)'
export function formatDate(date: string | null | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return '날짜 미정'
  const weekday = WEEKDAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()]
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 (${weekday})`
}

// 여러 날 여행이면 "2026년 11월 14일 (토) ~ 2026년 11월 16일 (월) · 2박 3일", 하루짜리·끝 날짜 없음이면 시작일만
export function formatDateRange(date: string | null | undefined, endDate: string | null | undefined): string {
  if (!date || !endDate || endDate <= date) return formatDate(date)
  const [a, b] = [date, endDate].map(d => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))))
  const nights = Math.round((b - a) / 86_400_000)
  return `${formatDate(date)} ~ ${formatDate(endDate)} · ${nights}박 ${nights + 1}일`
}

// "YYYY-MM" 또는 "YYYY-MM-DD" 를 "YYYY.MM" 으로. 형식이 맞지 않으면 null
function checkedMonth(checkedAt?: string | null): string | null {
  const m = checkedAt?.trim().match(/^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/)
  return m ? `${m[1]}.${m[2]}` : null
}

// TMAP 주소의 경로로 어떤 경로 안내인지 가린다. 자가용·택시 구간도 같은 호스트(자동차 경로)라서
// 호스트만 보고 "보행자 경로"라고 쓰면 차 구간의 근거가 틀린다 (서버 출처: src/lib/geo/validation.ts)
function tmapSourceName(pathname: string): string {
  const path = pathname.toLowerCase().replace(/\/+$/, '')
  if (path === '/tmap/routes/pedestrian') return 'TMAP 보행자 경로'
  if (path === '/tmap/routes') return 'TMAP 자동차 경로'
  return 'TMAP'
}

// 출처가 주소(URL)면 읽기 쉬운 이름으로: TMAP 은 경로 종류(보행자·자동차)까지, 그 밖은 사이트 이름(도메인)
export function sourceName(source: string): string {
  if (!source.toLowerCase().startsWith('http://') && !source.toLowerCase().startsWith('https://')) return source
  try {
    const url = new URL(source)
    const host = url.hostname.replace(/^www\./, '')
    return host === 'apis.openapi.sk.com' ? tmapSourceName(url.pathname) : host
  } catch {
    return source
  }
}

// 근거 줄: "출처: {source} · {YYYY.MM} 확인". 출처나 날짜가 비어 있으면 "출처 확인 중" (설계 2.3)
export function sourceLine(source?: string | null, checkedAt?: string | null): string {
  const month = checkedMonth(checkedAt)
  const name = source?.trim()
  if (!name || !month) return '출처 확인 중'
  return `출처: ${sourceName(name)} · ${month} 확인`
}

export const CONFIDENCE_TEXT: Record<Confidence, string> = {
  A: '공식 안내·현장 확인',
  B: '지도에서 측정',
  C: '사진·후기로 추정',
}

// 계단 문구. "계단 없음"은 사람이 확인한 confirmed_none 일 때만 쓴다 (AGENTS.md 6장)
export function stairsText(status: StairsStatus, count?: number): string {
  if (status === 'present') return count ? `계단 ${count}칸` : '계단 있음'
  if (status === 'confirmed_none') return '계단 없음'
  return '계단 기록 없음 (지도 데이터 기준)'
}

// 장소 하나의 계단 상태. 구간이 없거나 기록 없는 구간이 섞이면 'unknown' — "계단 없음"은 모두 확인됐을 때만
export function stopStairsState(segments: Pick<SegmentResult, 'stairsStatus' | 'reverse'>[]): 'present' | 'confirmed_none' | 'unknown' {
  if (segments.some(s => !s.reverse && s.stairsStatus === 'present')) return 'present'
  if (segments.length > 0 && segments.every(s => s.stairsStatus === 'confirmed_none')) return 'confirmed_none'
  return 'unknown'
}

export const TRANSPORT_TEXT: Record<Transport, string> = { walk: '걸어서', car: '자가용', taxi: '택시', bus: '버스' }

export const REACTION_TEXT: Record<Reaction, string> = {
  too_far: '너무 멀어요',
  stairs_worry: '계단이 걱정돼요',
  must_go: '꼭 가고 싶어요',
  need_rest: '쉬는 곳이 더 있었으면',
  prefer_other: '다른 곳이 좋겠어요',
}

// 반응마다 색이 아니라 글과 기호로도 구분되게 한다
export const REACTION_MARK: Record<Reaction, string> = {
  too_far: '↔',
  stairs_worry: '!',
  must_go: '♥',
  need_rest: '☕',
  prefer_other: '↻',
}

// "1번째 안 · 오하연이 만들었어요" / "2번째 안 · AI가 만들었어요"
export function versionLabel(v: Pick<VersionSummary, 'number'>): string {
  return `${v.number}번째 안`
}

export function madeByText(v: Pick<VersionSummary, 'madeBy' | 'madeByName'>): string {
  if (v.madeBy === 'ai') return 'AI가 만들었어요'
  if (v.madeBy === 'quick_fix') return `${v.madeByName ?? '가족'}이 빠른 수정안으로 만들었어요`
  return `${v.madeByName ?? '가족'}이 만들었어요`
}

// 장소 안 길을 아직 조사하지 못해 아무것도 계산되지 않은 경우(정보 부족, 합계 0). 추정한 값이 아니라 값이 없는 것이다
export function isWalkInfoMissing(minutes: Minutes, verdict: Verdict): boolean {
  return verdict === 'info' && minutes.high === 0
}

// 걷는 시간 문장. 아무것도 계산되지 않았을 때는
// "약 0분"이라고 하면 걷지 않는다는 뜻으로 읽히므로 "정보 없음"으로 보여 준다 (장소 API 안내: 빈 경로를 걷기 0분으로 해석하면 안 됨)
export function formatWalk(minutes: Minutes, verdict: Verdict): string {
  return isWalkInfoMissing(minutes, verdict) ? '정보 없음' : formatRange(minutes)
}

// 차·택시·버스 이동 시간 문장. TMAP 은 아주 가까운 구간을 0.3분처럼 주는데, 반올림해 "약 0분"이라고 하면
// 이동이 없다는 뜻으로 읽히므로 1분이 안 되면 "약 1분 이내"로 쓴다. 숫자는 엔진 결과를 글로만 바꾸고,
// 다른 시간처럼 추정치라고 붙인다 (AGENTS.md 6장)
export function formatRideMin(rideMin: number): string {
  const text = rideMin < 1 ? '약 1분 이내' : `약 ${Math.round(rideMin)}분`
  return `${text} · 추정치`
}

// 차·택시·버스 구간 중 이동 시간을 모르는 것의 수. 엔진은 탈것 구간을 missingLegs 에 넣지 않으므로(걷는 시간이 0으로 확실)
// 결과의 legs 에서 rideMin 이 null 인 것으로 센다. 시간을 지어내지 않는다
export function countRideLegsWithoutTime(legs: Pick<LegResult, 'mode' | 'rideMin'>[]): number {
  return legs.filter(leg => leg.mode !== 'walk' && leg.rideMin === null).length
}

// 받지 못한 걷는 경로나 길 정보 없는 장소가 있으면 걷는 시간 합계는 일부만 계산한 값이다 → "조건 안"이라고 말하면 안 된다
export function hasWalkInfoGap(result: Pick<JudgeResult, 'missingLegs' | 'unknownStopKeys'>): boolean {
  return result.missingLegs.length > 0 || result.unknownStopKeys.length > 0
}

// 장소 안에서 걷는 길의 총 거리 문장. 돌아가는 길(reverse)은 오는 길과 같은 선이라 한 번만 센다.
// 거리는 장소 데이터의 구간 길이를 더한 값일 뿐이고 걷는 시간·판정은 엔진 결과를 쓴다. 구간 데이터가 없으면 null
export function placeWalkDistanceText(segments: Pick<SegmentResult, 'segmentId' | 'reverse'>[], lengthsM: Record<string, number>): string | null {
  const ids = [...new Set(segments.filter(s => !s.reverse).map(s => s.segmentId))]
  const totalM = ids.reduce((sum, id) => sum + (lengthsM[id] ?? 0), 0)
  if (ids.length === 0 || totalM <= 0) return null
  return totalM < 1000 ? `약 ${Math.round(totalM / 10) * 10}m` : `약 ${(totalM / 1000).toFixed(1)}km`
}

// 클립보드에 복사. 막혀 있으면 false (화면이 직접 복사하라고 안내한다)
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Web Share API 가 되면 공유창을, 안 되면 복사한다 (docs/roles/frontend.md 공통 화면 원칙)
export async function shareOrCopy(text: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text })
      return 'shared'
    }
  } catch (e) {
    // 사용자가 공유창을 닫은 경우는 실패가 아니다
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
  }
  return (await copyText(text)) ? 'copied' : 'failed'
}

// 걷기 조건 칸 이름과 값의 출처 (판정 결과의 condition / conditionFrom 을 근거 문장으로 보여 줄 때)
export const CONDITION_LABEL = {
  continuousMin: '쉬지 않고 걷기',
  dayMin: '하루 걷기',
  restMin: '한 번 쉬는 시간',
  avoidStairs: '계단 피하기',
} as const

export const CONDITION_SOURCE_TEXT = {
  parent: '부모님 기준',
  blend: '부모님과 일행을 함께 본 값',
  other: '일행 기준',
  default: '기본값 (알려 주지 않으셨어요)',
  tuned: '조건 바꿔 보기',
} as const

// 조건 값을 사람 말로: 분은 "20분", 계단 피하기는 "예 / 아니요"
export function conditionValueText(field: keyof typeof CONDITION_LABEL, value: number | boolean): string {
  if (field === 'avoidStairs') return value ? '피해요' : '괜찮아요'
  return `${value}분`
}

// 로그인이 필요한 화면에서 로그인 화면으로 보낼 주소. 돌아올 경로와 쿼리(?group= 등)를 함께 next 에 담는다
export function loginRedirectPath(pathname: string, search: string): string {
  const query = search.length > 1 && search.startsWith('?') ? search : ''
  return `/login?next=${encodeURIComponent(`${pathname}${query}`)}`
}

// 로그인이 필요한 화면에서 어디로 보낼지. 아직 확인 중(undefined)이거나 로그인했으면 null (보내지 않는다).
// 로그아웃 버튼으로 나간 경우(signedOut)에는 next 없이 첫 화면으로 보낸다 — 지금 화면을 next 에 담으면
// 다음에 다른 계정으로 로그인한 사람이 앞 사람의 여행 화면으로 돌아가 "구성원이 아니에요"(403)를 본다
export function requireUserRedirect(user: Pick<User, 'id'> | null | undefined, signedOut: boolean, pathname: string, search: string): string | null {
  if (user !== null) return null
  return signedOut ? '/' : loginRedirectPath(pathname, search)
}
