// 일정 초안 → 엔진 판정 → (조정 필요면) 한 번 다시 → 버전 저장. generate·revise가 같이 쓴다.
// AI는 장소·순서·시간만 고르고, 걷는 시간·계단 수·판정은 엔진 결과만 쓴다 (설계 6.4).
import 'server-only'
import type {
  JudgeResult,
  JudgeSummary,
  Leg,
  PlaceDetail,
  Stop,
  Traveler,
  TripVersion,
} from '@/lib/contracts'
import { formatRange, judge, requiredLegs } from '@/lib/engine'
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { draftsToStops, type DraftStop } from './stops'

// feedback이 null이면 처음 초안, 문자열이면 앞 판정의 위반을 알려 주고 다시 고른 초안.
export type PlanAttempt = (feedback: string | null) => Promise<DraftStop[]>

type JudgeArgs = {
  tripId: string
  travelers: Traveler[]
  transport: 'car' | 'transit' | 'taxi'
  attempt: PlanAttempt
  parentId: string | null
  note?: string
  appliedOpinionIds?: string[]
  madeByUserId?: string
}

type Run = { stops: Stop[]; result: JudgeResult }

function placeRecords(details: PlaceDetail[]): Record<string, PlaceDetail> {
  return Object.fromEntries(details.map(place => [place.id, place] as const))
}

function legRecords(legs: Leg[]): Record<string, Leg> {
  return Object.fromEntries(legs.map(leg => [leg.key, leg] as const))
}

async function runAttempt(drafts: DraftStop[], args: JudgeArgs, deps: AiDeps): Promise<Run> {
  const placeIds = [
    ...new Set(drafts.flatMap(draft => (draft.placeId === null ? [] : [draft.placeId]))),
  ]
  // 조회가 실패해도 멈추지 않고 '정보 부족'으로 판정한다 (설계 6.4).
  let details: PlaceDetail[] = []
  try {
    details = await deps.getPlaceDetails(placeIds)
  } catch (error) {
    console.error('[ai]', '장소·경로 조회 실패', error instanceof Error ? error.name : typeof error)
    details = []
  }
  const places = placeRecords(details)
  const stops = draftsToStops(drafts, args.transport, places)
  let legs: Leg[] = []
  try {
    legs = await deps.getLegs(requiredLegs(stops, places))
  } catch (error) {
    console.error('[ai]', '장소·경로 조회 실패', error instanceof Error ? error.name : typeof error)
    legs = []
  }
  const result = judge({ travelers: args.travelers, stops, places, legs: legRecords(legs) })
  return { stops, result }
}

function stopName(stops: Stop[], key: string | null | undefined): string {
  if (key === null || key === undefined) return ''
  return stops.find(stop => stop.key === key)?.name ?? key
}

// 두 번째 AI 요청에 붙일 위반 목록. 숫자는 모두 엔진 결과에서만 가져온다.
// 앞 일정은 이름·id만 적는다 — 숫자는 엔진 문장에서만 쓴다 (설계 6.4).
function feedbackText(result: JudgeResult, stops: Stop[]): string {
  const prevLine = `앞 일정: ${stops.map((stop, i) => `${i + 1}) ${stop.name}(id: ${stop.placeId ?? '없음'})`).join(' ')}`
  const lines = result.violations.map(violation => {
    if (violation.kind === 'stairs') {
      const leg = result.legs.find(item => item.legKey === violation.legKey)
      const where =
        violation.stopKey !== null
          ? `${stopName(stops, violation.stopKey)} 안`
          : leg
            ? `${stopName(stops, leg.fromStopKey)}에서 ${stopName(stops, leg.toStopKey)} 가는 길`
            : '장소 사이 길'
      return `${where}에 계단${violation.count !== undefined ? ` ${violation.count}칸` : ''}이 있어요`
    }
    if (violation.kind === 'continuous') {
      return `쉬지 않고 ${formatRange({ base: result.longest.base, high: result.longest.high })}을 걸어야 해요 (조건 ${result.condition.continuousMin}분, ${Math.round(violation.over)}분 초과)`
    }
    return `하루 동안 모두 ${formatRange(result.day)}을 걸어야 해요 (조건 ${result.condition.dayMin}분, ${Math.round(violation.over)}분 초과)`
  })
  return [prevLine, result.reason, ...lines].join('\n')
}

function verdictRank(verdict: JudgeResult['verdict']): number {
  // ok가 가장 좋고 adjust가 가장 나쁘다.
  if (verdict === 'ok') return 0
  if (verdict === 'info') return 1
  return 2
}

export async function planJudgeSave(
  args: JudgeArgs,
  deps: AiDeps,
): Promise<{ version: TripVersion; summary: JudgeSummary; result: JudgeResult }> {
  // 빈 초안은 고른 장소가 하나도 없는 것으로 AI 실패로 본다 (설계 6.4).
  const firstDrafts = await args.attempt(null)
  if (firstDrafts.length === 0) {
    throw new AiCallError('invalid_output', 'AI가 빈 일정을 돌려줬어요')
  }
  const first = await runAttempt(firstDrafts, args, deps)
  let chosen = first

  if (first.result.verdict === 'adjust') {
    try {
      const secondDrafts = await args.attempt(feedbackText(first.result, first.stops))
      // 두 번째가 비면 첫 결과를 쓴다.
      if (secondDrafts.length === 0) {
        chosen = first
      } else {
        const second = await runAttempt(secondDrafts, args, deps)
        // 판정 순위(ok > info > adjust) 먼저, 같으면 위반 수 적은 쪽, 같으면 두 번째.
        const firstRank = verdictRank(first.result.verdict)
        const secondRank = verdictRank(second.result.verdict)
        if (secondRank < firstRank) {
          chosen = second
        } else if (secondRank > firstRank) {
          chosen = first
        } else {
          chosen = second.result.violations.length <= first.result.violations.length ? second : first
        }
      }
    } catch (error) {
      // 두 번째 실패는 첫 결과를 저장한다. 첫 번째 실패만 밖으로 나간다 (설계 6.4).
      if (error instanceof AiCallError) {
        chosen = first
      } else {
        throw error
      }
    }
  }

  const version = await deps.createVersion(args.tripId, {
    parentId: args.parentId,
    stops: chosen.stops,
    madeBy: 'ai',
    ...(args.madeByUserId !== undefined ? { madeByUserId: args.madeByUserId } : {}),
    ...(args.note !== undefined ? { note: args.note } : {}),
    ...(args.appliedOpinionIds !== undefined ? { appliedOpinionIds: args.appliedOpinionIds } : {}),
  })

  const summary: JudgeSummary = {
    verdict: chosen.result.verdict,
    reason: chosen.result.reason,
    day: chosen.result.day,
    longest: chosen.result.longest,
  }

  return { version, summary, result: chosen.result }
}
