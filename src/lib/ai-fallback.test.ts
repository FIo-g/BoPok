import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '@/lib/api-client/http'
import { aiFailure } from './ai-fallback'

describe('AI 실패 대체 동작', () => {
  it('pick_places 는 직접 고르기만, 다시 시도는 없다', () => {
    const f = aiFailure(new ApiRequestError(502, 'ai_failed', 'x', 'pick_places'))
    expect(f).toMatchObject({ canRetry: false, canPick: true })
  })

  it('retry_or_pick 은 다시 시도와 직접 고르기 둘 다', () => {
    expect(aiFailure(new ApiRequestError(502, 'ai_failed', 'x', 'retry_or_pick'))).toMatchObject({ canRetry: true, canPick: true })
  })

  it('대체 동작이 없으면 서버가 준 쉬운 말과 다시 시도만', () => {
    expect(aiFailure(new ApiRequestError(500, 'internal_error', '잠시 뒤에 다시 해 주세요'))).toEqual({ message: '잠시 뒤에 다시 해 주세요', canRetry: true, canPick: false })
  })
})
