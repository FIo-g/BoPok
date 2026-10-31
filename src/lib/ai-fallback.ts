// AI 실패 때 화면이 돌아갈 길 (contracts 의 AiFallback, 설계 6.4)
//  pick_places   = 직접 고르기만 (다시 시도해도 소용없을 때)
//  retry_or_pick = 다시 시도 + 직접 고르기
//  fixed_text    = 고정 문장으로 대신한다 (에러가 아니라 알림)
//  없음          = 일시적인 문제로 보고 다시 시도
import { isApiError } from '@/lib/api-client'
import { errorMessage } from '@/lib/use-async'

export type AiFailure = { message: string; canRetry: boolean; canPick: boolean }

export function aiFailure(e: unknown): AiFailure {
  const fallback = isApiError(e) ? e.fallback : undefined
  if (fallback === 'pick_places') return { message: 'AI가 지금은 도와드리지 못해요. 장소를 직접 골라 주세요.', canRetry: false, canPick: true }
  if (fallback === 'retry_or_pick') return { message: 'AI가 잘 안 됐어요. 다시 시도하거나 장소를 직접 골라 주세요.', canRetry: true, canPick: true }
  return { message: errorMessage(e), canRetry: true, canPick: false }
}
