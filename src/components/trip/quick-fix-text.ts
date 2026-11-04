// 빠른 수정안 카드의 한 줄 판정 문구. 정보가 없는 곳(info)을 '조건에 맞음'으로 말하지 않으려고 따로 뺐다 (AGENTS 6장).
// 기호는 배지(VerdictBadge)와 맞춘다: 조건 충족 ✓, 조정 필요 !, 정보 부족 ?.
import type { Verdict } from '@/lib/contracts'

export function quickFixStatus({ enough, verdict }: { enough: boolean; verdict: Verdict }): { tone: 'ok' | 'info' | 'warn'; text: string } {
  if (!enough) return { tone: 'warn', text: '! 그래도 조건을 넘는 곳이 남아요' }
  if (verdict === 'info') return { tone: 'info', text: '? 조건을 넘는 곳은 없어요 · 정보가 없는 곳은 확인이 필요해요' }
  return { tone: 'ok', text: '✓ 이렇게 하면 조건에 맞아요' }
}

// 수정안이 하나도 없을 때의 안내. 기준 판정이 조정 필요(adjust)인데 안을 못 찾은 경우도 '조건에 맞다'고 하지 않는다.
export function quickFixEmptyNotice(verdict: Verdict): { tone: 'ok' | 'info' | 'warn'; text: string } {
  if (verdict === 'info') return { tone: 'info', text: '조건을 넘는 곳은 없어요. 정보가 없는 곳은 확인이 필요해요.' }
  if (verdict === 'adjust') return { tone: 'warn', text: '빠른 수정안을 찾지 못했어요. “직접 고치기”로 장소를 바꿔 보세요.' }
  return { tone: 'ok', text: '고칠 곳이 없어요. 이 일정은 지금 조건에 맞아요.' }
}
