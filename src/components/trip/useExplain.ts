'use client'

// 이전 안과 달라진 점 한 줄 (POST /api/ai/explain). 화면에 보여 주기만 하고 저장하지 않는다 (설계 6.1).
// 숫자는 엔진 비교 결과(diffSummary)에서만 나오고, AI 는 그 숫자로 문장을 다듬는다. 실패하면 아무것도 보여 주지 않는다
// (엔진 숫자 줄은 늘 따로 보인다). 같은 버전을 다시 열 때 AI 를 또 부르지 않도록 이번 방문 동안 기억해 둔다.
import { api } from '@/lib/api-client'
import type { ExplainResponse, JudgeResult, QuickFixChange } from '@/lib/contracts'
import { useAsync } from '@/lib/use-async'

const remembered = new Map<string, ExplainResponse | null>()

export function useExplain(args: {
  tripId: string
  versionId: string | null
  prev: JudgeResult | null
  next: JudgeResult | null
  changes?: QuickFixChange[]
  enabled: boolean
}): ExplainResponse | null {
  const { tripId, versionId, prev, next, changes, enabled } = args
  const ready = enabled && versionId !== null && prev !== null && next !== null
  const key = `explain:${tripId}:${versionId}:${changes?.length ?? 0}`
  const state = useAsync<ExplainResponse | null>(
    async () => {
      if (remembered.has(key)) return remembered.get(key) ?? null
      try {
        const res = await api.ai.explain({ tripId, prev: prev!, next: next!, changes })
        remembered.set(key, res)
        return res
      } catch {
        remembered.set(key, null)
        return null
      }
    },
    key,
    ready,
  )
  return state.data ?? null
}
