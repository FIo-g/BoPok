// 일정 화면(TripScreen)의 판단을 React 없이 떼어 둔 함수들. 화면 테스트 환경(node, jsdom 없음)에서도 검사할 수 있게 둔다.

import type { ExplainResponse, TripVersion } from '@/lib/contracts'

// 여행 정보(TripDetail)에 같이 온 처음 안을 바로 쓸 수 있는지 본다.
// 고른 안(activeId)과 id가 같을 때만 쓴다. 다른 안을 고르면 버전 API로 따로 받는다.
export function preloadedVersion(initial: TripVersion | null | undefined, activeId: string | null): TripVersion | null {
  if (activeId === null || !initial || initial.id !== activeId) return null
  return initial
}

// "일정을 계산하고 있어요"를 띄울지 정한다.
// 고른 안이 없으면(버전이 없는 여행) 기다릴 안이 없으므로 띄우지 않는다. 안이 있으면 그 안을 기다리는 동안 띄운다.
export function showScheduleSpinner({ activeId, versionLoading, hasStops, canJudge }: {
  activeId: string | null
  versionLoading: boolean
  hasStops: boolean
  canJudge: boolean
}): boolean {
  if (activeId === null) return false
  return versionLoading || (hasStops && canJudge)
}

// 바뀐 점 한 줄을 화면에 보일지 정한다. 엔진 비교가 "바뀐 점 없음"이어도 일정 칸에서 바뀐 곳이 있으면
// 그 고정 문장은 틀린 말이므로 숨기고, 일정에서 바뀐 곳 줄이 대신 보인다.
export function explainTextToShow(explain: ExplainResponse | null, stopChanges: string[]): string | null {
  if (!explain) return null
  if (explain.source === 'fixed' && explain.text === '바뀐 점 없음' && stopChanges.length > 0) return null
  return explain.text
}
