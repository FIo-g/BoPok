// 구간 하나의 걷는 시간과 범위 (설계 7.2). 숫자는 constants.ts만 쓴다.
import type { Minutes, Transport } from '@/lib/contracts'
import { MARGIN_RATE, SLOPE_WEIGHT, STAIRS_WEIGHT } from './constants'

// 계단·경사가 함께 있으면 두 가중치를 곱한다 (설계 7.2 식 그대로).
export function walkMinutes(
  distanceM: number,
  speedMps: number,
  opts: { stairs: boolean; slope: boolean },
): number {
  return (
    (distanceM / (speedMps * 60)) *
    (opts.stairs ? STAIRS_WEIGHT : 1) *
    (opts.slope ? SLOPE_WEIGHT : 1)
  )
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
