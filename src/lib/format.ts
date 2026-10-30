// 화면에 보이는 문장을 만드는 작은 함수들. 판정·걷는 시간 숫자는 만들지 않고 엔진 결과를 글로만 바꾼다.
import type { Confidence, Reaction, SegmentResult, StairsStatus, Transport, VersionSummary } from '@/lib/contracts'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

// '2026-11-14' → '2026년 11월 14일 (토)'
export function formatDate(date: string | null | undefined): string {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return '날짜 미정'
  const weekday = WEEKDAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()]
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 (${weekday})`
}

// "YYYY-MM" 또는 "YYYY-MM-DD" 를 "YYYY.MM" 으로. 형식이 맞지 않으면 null
function checkedMonth(checkedAt?: string | null): string | null {
  const m = checkedAt?.trim().match(/^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/)
  return m ? `${m[1]}.${m[2]}` : null
}

// 근거 줄: "출처: {source} · {YYYY.MM} 확인". 출처나 날짜가 비어 있으면 "출처 확인 중" (설계 2.3)
export function sourceLine(source?: string | null, checkedAt?: string | null): string {
  const month = checkedMonth(checkedAt)
  const name = source?.trim()
  if (!name || !month) return '출처 확인 중'
  return `출처: ${name} · ${month} 확인`
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
