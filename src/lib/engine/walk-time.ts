// 구간 하나의 걷는 시간과 범위 (설계 7.2). 숫자는 constants.ts만 쓴다.
import type { Minutes, Transport } from '@/lib/contracts'
import {
  MARGIN_RATE,
  SLOPE_WEIGHT,
  SLOW_CAP_MPS,
  STAIR_STEP_SEC,
  STAIR_STEP_SEC_SLOW,
  STAIR_TREAD_M,
  STAIRS_WEIGHT,
} from './constants'

const EPS = 1e-9

// 계단 칸 수를 알면 칸마다 시간을 더하고(계단 실측), 나머지 거리는 평지 속도로 센다. 경사 배수는 평지 부분에만 곱한다.
// 칸 수 기록이 없으면 예전처럼 거리 전체에 임시 배수를 곱한다 — 칸 수를 지어내지 않기 위해서다.
export function walkMinutes(
  distanceM: number,
  speedMps: number,
  opts: { stairs: boolean; slope: boolean; stairsCount?: number },
): number {
  const slopeWeight = opts.slope ? SLOPE_WEIGHT : 1
  const perMeterMin = 1 / (speedMps * 60)
  if (opts.stairs && opts.stairsCount !== undefined) {
    const flatM = Math.max(0, distanceM - opts.stairsCount * STAIR_TREAD_M)
    // 느린 사람(천천히·보조기구 상한 이하)은 계단 칸 시간도 느린 쪽 값을 쓴다
    const stepSec = speedMps <= SLOW_CAP_MPS + EPS ? STAIR_STEP_SEC_SLOW : STAIR_STEP_SEC
    return flatM * perMeterMin * slopeWeight + (opts.stairsCount * stepSec) / 60
  }
  return distanceM * perMeterMin * (opts.stairs ? STAIRS_WEIGHT : 1) * slopeWeight
}

// 화면에는 늘 범위로 보여 준다 (설계 2.3·7.2).
export function toRange(baseMin: number): Minutes {
  return { base: baseMin, high: baseMin * (1 + MARGIN_RATE) }
}

// 반올림 경계(0.499999…)가 1분을 깎지 않게 아주 작은 값을 더한다.
function roundMin(value: number): number {
  return Math.round(value + 1e-9)
}

// 위 끝은 올림한다 — 조건을 넘은 위반이 숫자로는 안 넘어 보이지 않게 한다 (설계 7.3.1).
function ceilMin(value: number): number {
  return Math.ceil(value - 1e-9)
}

export function formatRange(m: Minutes): string {
  const base = roundMin(m.base)
  const high = ceilMin(m.high)
  return base === high ? `약 ${base}분` : `약 ${base}~${high}분`
}

// 장소에 들어올 때 쓰는 이동수단 → 장소 안 출발 지점. 걷기는 입구부터다 (설계 7.3.1).
export function startNodeKind(mode: Transport): 'parking' | 'stop' | null {
  if (mode === 'car' || mode === 'taxi') return 'parking'
  if (mode === 'bus') return 'stop'
  return null
}
