// 버전 비교 카드 (설계 7.3·7.4). 바뀐 항목만 정해진 순서로 만든다.
import type { DiffItem, JudgeResult, Minutes, QuickFixChange, Stop, Verdict } from '@/lib/contracts'
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

// 일정 칸 비교 (버전 간 일정이 바뀌었는데 걷는 구간이 같을 때도 무엇이 바뀌었는지 말하려고 둔다).
// 시각은 Stop 에 저장된 값 그대로 쓴다. 숫자를 새로 만들지 않는다.
export type StopDiffItem =
  | { kind: 'added'; name: string }
  | { kind: 'removed'; name: string }
  | { kind: 'time'; name: string; before: string; after: string }

// 같은 장소 판별: placeId 가 있으면 placeId, 없으면(점심 같은 식사 자리) 이름
function stopIdentity(stop: Stop): string {
  return stop.placeId !== null ? `place:${stop.placeId}` : `name:${stop.name}`
}

// 순서만 바뀐 것은 다루지 않는다. 새 안 순서대로 추가·시각 변경을 적고, 뺀 곳은 뒤에 붙인다.
export function diffStops(prev: Stop[], next: Stop[]): StopDiffItem[] {
  // 이전 안의 같은 장소는 한 번만 짝짓는다 (같은 이름이 여럿이면 앞에서부터)
  const used = new Set<number>()
  const matches = next.map(stop => {
    const index = prev.findIndex((before, i) => !used.has(i) && stopIdentity(before) === stopIdentity(stop))
    if (index === -1) return null
    used.add(index)
    return prev[index]
  })

  const items: StopDiffItem[] = []
  next.forEach((stop, i) => {
    const before = matches[i]
    if (before === null) {
      items.push({ kind: 'added', name: stop.name })
      return
    }
    // 시각은 양쪽에 다 있을 때만 비교한다 (한쪽만 비었으면 바뀌었다고 말하지 않는다)
    if (before.startTime !== undefined && stop.startTime !== undefined && before.startTime !== stop.startTime) {
      items.push({ kind: 'time', name: stop.name, before: before.startTime, after: stop.startTime })
    }
  })
  prev.forEach((stop, i) => {
    if (!used.has(i)) items.push({ kind: 'removed', name: stop.name })
  })
  return items
}

export function formatStopDiffItem(item: StopDiffItem): string {
  switch (item.kind) {
    case 'added':
      return `새로 넣은 곳: ${item.name}`
    case 'removed':
      return `뺀 곳: ${item.name}`
    case 'time':
      return `시간 바뀜: ${item.name} ${item.before} → ${item.after}`
  }
}

// 화면 한 줄에 다 들어가도록 4개까지만 쓰고 나머지는 "외 n곳"으로 센다.
const STOP_DIFF_SHOWN = 4

export function formatStopDiff(items: StopDiffItem[]): string[] {
  const sentences = items.map(formatStopDiffItem)
  if (sentences.length <= STOP_DIFF_SHOWN) return sentences
  return [...sentences.slice(0, STOP_DIFF_SHOWN), `외 ${sentences.length - STOP_DIFF_SHOWN}곳`]
}
