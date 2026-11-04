// 조건 바꿔 보기로 바꾼 값 (저장하지 않는다, 설계 4.4). 판정 엔진에는 값을 바꾼 여행자·일정을 넣어 다시 판정하게 한다.
import type { Condition, Pace, Stop, Traveler, Transport } from '@/lib/contracts'

export type Tuned = {
  // 걷기 조건 칸(쉬지 않고 걷기·하루 걷기·쉬는 시간·계단 피하기). 엔진 judge 의 tuned 로 그대로 간다
  condition?: Partial<Condition>
  // 함께 가는 모두의 걷는 속도·보조기구·장소 사이 이동수단을 한꺼번에 바꿔 본다
  pace?: Exclude<Pace, 'unknown'>
  mobilityAid?: boolean
  transport?: Transport
}

export function isTuned(tuned: Tuned | undefined): tuned is Tuned {
  if (!tuned) return false
  return Object.keys(tuned.condition ?? {}).length > 0 || tuned.pace !== undefined || tuned.mobilityAid !== undefined || tuned.transport !== undefined
}

// 빈 값은 undefined 로 돌려 "바꿔 본 게 없다"를 한 가지로만 나타낸다
export function cleanTuned(tuned: Tuned): Tuned | undefined {
  const next: Tuned = { ...tuned }
  if (next.condition && Object.keys(next.condition).length === 0) delete next.condition
  for (const key of ['pace', 'mobilityAid', 'transport'] as const) if (next[key] === undefined) delete next[key]
  return isTuned(next) ? next : undefined
}

export function applyTuned(travelers: Traveler[], stops: Stop[], tuned: Tuned | undefined): { travelers: Traveler[]; stops: Stop[] } {
  if (!isTuned(tuned)) return { travelers, stops }
  const { pace, mobilityAid, transport } = tuned
  return {
    travelers: pace === undefined && mobilityAid === undefined ? travelers : travelers.map(t => ({ ...t, ...(pace !== undefined ? { pace } : {}), ...(mobilityAid !== undefined ? { mobilityAid } : {}) })),
    stops: transport === undefined ? stops : stops.map(s => ({ ...s, arriveBy: transport })),
  }
}
