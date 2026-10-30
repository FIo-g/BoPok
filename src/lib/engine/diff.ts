// 버전 비교 카드 (설계 7.3·7.4). 바뀐 항목만 정해진 순서로 만든다.
import type { DiffItem, JudgeResult, Minutes, QuickFixChange, Verdict } from '@/lib/contracts'
import { formatRange } from './walk-time'

const VERDICT_LABEL: Record<Verdict, string> = {
  ok: '조건 충족',
  adjust: '조정 필요',
  info: '정보 부족',
}

// 화면 문장과 같은 기준(분 단위 반올림)으로 같고 다름을 본다.
function sameMinutes(a: Minutes, b: Minutes): boolean {
  return formatRange(a) === formatRange(b)
}

function stairsCount(result: JudgeResult): number {
  return result.violations.filter(violation => violation.kind === 'stairs').length
}

export function diffSummary(prev: JudgeResult, next: JudgeResult): DiffItem[] {
  const items: DiffItem[] = []

  if (prev.verdict !== next.verdict) {
    items.push({ kind: 'verdict', before: prev.verdict, after: next.verdict })
  }

  const stairsBefore = stairsCount(prev)
  const stairsAfter = stairsCount(next)
  if (stairsBefore !== stairsAfter) {
    items.push({ kind: 'stairs', before: stairsBefore, after: stairsAfter })
  }

  if (!sameMinutes(prev.longest, next.longest)) {
    items.push({
      kind: 'longest',
      before: { base: prev.longest.base, high: prev.longest.high },
      after: { base: next.longest.base, high: next.longest.high },
    })
  }

  if (!sameMinutes(prev.day, next.day)) {
    items.push({ kind: 'day', before: prev.day, after: next.day })
  }

  if (prev.restTotalMin !== next.restTotalMin) {
    items.push({ kind: 'restTotal', before: prev.restTotalMin, after: next.restTotalMin })
  }

  return items
}

export function formatDiffItem(item: DiffItem): string {
  switch (item.kind) {
    case 'verdict':
      return `판정 ${VERDICT_LABEL[item.before]} → ${VERDICT_LABEL[item.after]}`
    case 'stairs':
      return `계단 구간 ${item.before}곳 → ${item.after}곳`
    case 'longest':
      return `가장 긴 연속 걷기 ${formatRange(item.before)} → ${formatRange(item.after)}`
    case 'day':
      return `하루 총 걷기 ${formatRange(item.before)} → ${formatRange(item.after)}`
    case 'restTotal':
      return `쉬는 시간 ${item.before}분 → ${item.after}분`
  }
}

// AI 설명이 실패해도 카드에 쓸 수 있는 고정 문장 (설계 6.1).
export function fixedChangeSentence(changes: QuickFixChange[]): string {
  if (changes.length === 0) return '바뀐 점 없음'

  const counts = { detour: 0, skip: 0, rest: 0, taxi: 0 }
  for (const change of changes) counts[change.kind] += 1

  const parts: string[] = []
  if (counts.detour > 0) parts.push(`계단 구간 ${counts.detour}곳을 우회로로 변경`)
  if (counts.skip > 0) parts.push(`선택 구간 ${counts.skip}곳 빼기`)
  if (counts.rest > 0) parts.push(`쉼터 ${counts.rest}곳에서 쉬기`)
  if (counts.taxi > 0) parts.push(`장소 사이 ${counts.taxi}곳을 택시로`)

  return parts.join(', ')
}
