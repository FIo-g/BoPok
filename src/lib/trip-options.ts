// 인터뷰와 장소 고르기에서 쓰는 고정 선택지 (docs/roles/frontend.md "인터뷰 화면")
import type { Budget } from '@/lib/contracts'

// 스타일 칩 + 그 밖은 직접 입력
export const STYLE_OPTIONS = ['관광·명소', '레저·체험', '휴식·힐링', '자연·산책', '맛집·음식', '문화·역사', '과학·전시', '온천·스파', '사진 명소', '쇼핑'] as const

// 1인당 하루 예산
export const BUDGET_TEXT: Record<Budget, string> = {
  under_30k: '3만 원 이하',
  '30k_50k': '3~5만 원',
  '50k_100k': '5~10만 원',
  over_100k: '10만 원 이상',
}
