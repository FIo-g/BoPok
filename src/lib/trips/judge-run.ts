// 판정을 한 번 돌리는 공용 길. 6단계(버전의 판정 요약)와 7단계(공유 글)가 같이 쓴다.
// 숫자는 전부 engine.judge에서 나온다 — 서버가 따로 계산하지 않는다 (AGENTS.md 6장).
import 'server-only'
import type { JudgeResult, JudgeSummary, Leg, PlaceDetail, Stop, Traveler } from '@/lib/contracts'
import { judge, requiredLegs } from '@/lib/engine'
import type { PlaceGeoDeps } from './place-geo'
import { getPlaceGeoDeps } from './place-geo'

export type { PlaceGeoDeps }

export type JudgeRun = {
  // 판정을 돌릴 수 없으면 null (여행자가 한 명도 없을 때). 숫자를 지어내지 않는다.
  result: JudgeResult | null
  places: Record<string, PlaceDetail>
  legs: Record<string, Leg>
}

export async function judgeStops(
  args: { stops: Stop[]; travelers: Traveler[]; tuned?: Partial<Traveler['condition']> },
  deps: PlaceGeoDeps = getPlaceGeoDeps(),
): Promise<JudgeRun> {
  // ① 일정에 있는 장소의 상세 (DB에 없는 장소는 placeId가 null이라 건너뛴다)
  const placeIds = [...new Set(args.stops.map(stop => stop.placeId).filter((id): id is string => Boolean(id)))]
  const details = placeIds.length > 0 ? await deps.getPlaceDetails(placeIds) : []
  const places: Record<string, PlaceDetail> = {}
  for (const detail of details) places[detail.id] = detail

  // ② 장소 사이 경로는 엔진이 '무엇이 필요한지' 알려 준다 (설계 7.3.1)
  const requests = requiredLegs(args.stops, places)
  const fetched = requests.length > 0 ? await deps.getLegs(requests) : []
  const legs: Record<string, Leg> = {}
  // 받지 못한 경로는 넣지 않는다 — 엔진이 missingLegs로 알려 준다
  for (const leg of fetched) legs[leg.key] = leg

  // ③ 여행자가 없으면 판정할 조건이 없다 (계약이 travelers 최소 1명)
  if (args.travelers.length === 0) return { result: null, places, legs }

  const result = judge({ travelers: args.travelers, tuned: args.tuned, stops: args.stops, places, legs })
  return { result, places, legs }
}

// 6단계에서 버전에 저장할 요약. 판정을 못 돌렸으면 null로 저장한다.
export function summaryOf(run: JudgeRun): JudgeSummary | null {
  if (!run.result) return null
  const { verdict, reason, day, longest } = run.result
  return { verdict, reason, day, longest }
}

// 요약 계산에 두는 시간 제한. 버전을 저장할 때 TMAP을 실제로 부르므로, 느린 날에
// '일정 저장'이 한참 걸리면 안 된다. 넘기면 기다리지 않고 요약 없이(null) 저장한다.
export const SUMMARY_TIMEOUT_MS = 8_000

let timeoutMs = SUMMARY_TIMEOUT_MS

// 테스트에서만 바꾼다 (진짜로 8초 기다리지 않게). null이면 기본값으로 돌린다.
export function setSummaryTimeoutForTests(ms: number | null): void {
  timeoutMs = ms ?? SUMMARY_TIMEOUT_MS
}

class SummaryTimeout extends Error {}

// 제한 시간이 지나면 기다리지 않는다. 이미 시작한 TMAP 요청을 취소할 수는 없지만,
// 그 결과는 src/lib/geo의 leg_cache에 남아 다음 계산에서 쓰인다.
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SummaryTimeout(`${ms}ms`)), ms)
  })
  return Promise.race([task, limit]).finally(() => clearTimeout(timer)) as Promise<T>
}

// 버전에 저장할 판정 요약. **어떤 일이 있어도 던지지 않는다** — 요약을 못 만들어도
// 일정·여행자 저장은 반드시 성공해야 한다 (요약은 목록에 배지를 띄우는 부가 정보다).
export async function safeSummary(
  args: { stops: Stop[]; travelers: Traveler[] },
  deps?: PlaceGeoDeps,
): Promise<JudgeSummary | null> {
  // 여행자가 없으면 판정할 조건이 없다 — 장소·경로를 부를 필요도 없다.
  if (args.travelers.length === 0) return null

  try {
    return summaryOf(await withTimeout(judgeStops(args, deps), timeoutMs))
  } catch (error) {
    const reason = error instanceof SummaryTimeout ? `시간 초과 ${error.message}` : error
    console.error('[acct] 판정 요약을 만들지 못해 요약 없이 저장해요', reason)
    return null
  }
}
