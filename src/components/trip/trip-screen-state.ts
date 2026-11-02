// 일정 화면(TripScreen)의 판단을 React 없이 떼어 둔 함수들. 화면 테스트 환경(node, jsdom 없음)에서도 검사할 수 있게 둔다.

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
