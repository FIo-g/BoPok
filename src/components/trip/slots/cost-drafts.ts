export { costScope, placeCostKey, taxiCostKey } from '@/lib/contracts/cost-plan'

export function applyUneditedQuotes<T>(current: Record<string, T>, requested: Record<string, T>, quotes: Record<string, T>): Record<string, T> {
  const next = { ...current }
  for (const [key, quote] of Object.entries(quotes)) {
    // 조회 중 직접 고친 금액·단위·수량은 늦게 도착한 응답으로 덮어쓰지 않는다.
    if (current[key] === requested[key]) next[key] = quote
  }
  return next
}
