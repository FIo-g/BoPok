// 판정을 한 번 돌리는 공용 길. 6단계(버전의 판정 요약)와 7단계(공유 글)가 같이 쓴다.
// 숫자는 전부 engine.judge에서 나온다 — 서버가 따로 계산하지 않는다 (AGENTS.md 6장).
import 'server-only'
import type { JudgeResult, JudgeSummary, Leg, PlaceDetail, Stop, Traveler } from '@/lib/contracts'
import { judge, requiredLegs } from '@/lib/engine'
import type { PlaceGeoDeps } from './place-geo'
import { getPlaceGeoDeps } from './place-geo'

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

// 6단계: 버전에 저장할 판정 요약을 만든다. 숫자는 judgeStops(= engine.judge)에서만 나온다.
// - 여행자가 없으면 판정할 조건이 없어 null이고, 장소·경로를 묻지도 않는다.
// - 판정 중 오류가 나도 null이다. 요약은 목록 표시용 곁가지라 일정 저장을 막지 않는다.
//   (경로를 못 받은 것은 place-geo가 이미 '경로 없음'으로 바꿔 오류가 아니다.)
export async function summarizeStops(
  args: { stops: Stop[]; travelers: Traveler[] },
  deps: PlaceGeoDeps = getPlaceGeoDeps(),
): Promise<JudgeSummary | null> {
  if (args.travelers.length === 0) return null
  try {
    return summaryOf(await judgeStops(args, deps))
  } catch (error) {
    // 키·요청 원문은 남기지 않고 오류 이름과 앞부분만 남긴다.
    const reason = error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : 'unknown'
    console.error('[acct] 판정 요약을 만들지 못해 비워 둠', reason)
    return null
  }
}
