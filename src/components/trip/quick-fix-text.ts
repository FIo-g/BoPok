// 빠른 수정안 카드의 한 줄 판정 문구. 정보가 없는 곳(info)을 '조건에 맞음'으로 말하지 않으려고 따로 뺐다 (AGENTS 6장).
import type { Verdict } from '@/lib/contracts'

export function quickFixStatus({ enough, verdict }: { enough: boolean; verdict: Verdict }): { tone: 'ok' | 'info' | 'warn'; text: string } {
  if (!enough) return { tone: 'warn', text: '! 그래도 조건을 넘는 곳이 남아요' }
  if (verdict === 'info') return { tone: 'info', text: '✓ 조건을 넘는 곳은 없어요 · 정보가 없는 곳은 확인이 필요해요' }
  return { tone: 'ok', text: '✓ 이렇게 하면 조건에 맞아요' }
}
