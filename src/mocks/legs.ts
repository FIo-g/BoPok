// 목업 장소 사이 경로. 실제로는 서버가 TMAP으로 받아 계단 검사까지 해서 준다(이동주).
// 여기서는 두 지점을 잇는 완만한 선과, 직선 거리에 도로 굽음(1.3배)을 곱한 거리를 만든다.
import { legKey, type Coord, type Leg, type LegRequest, type Transport } from '@/lib/contracts'
import { haversineM } from './geo-util'

const DETOUR_FACTOR = 1.3
// 탈것 평균 속도(m/분). 목업 값이라 정확하지 않다
const RIDE_M_PER_MIN: Record<Exclude<Transport, 'walk'>, number> = { car: 500, taxi: 500, bus: 300 }

function bendedPath(from: Coord, to: Coord): Coord[] {
  const mid: Coord = [(from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.08, (from[1] + to[1]) / 2 - (to[0] - from[0]) * 0.08]
  return [from, mid, to]
}

export function mockLeg(req: LegRequest): Leg {
  const { from, to, mode } = req
  const distanceM = Math.round(haversineM(from.coord, to.coord) * DETOUR_FACTOR)
  const base = {
    key: legKey(req),
    mode,
    distanceM,
    path: bendedPath(from.coord, to.coord),
    // 걷는 길의 계단은 아직 모르는 것으로 둔다 → 화면에 "계단 기록 없음"
    stairsStatus: 'unknown' as const,
    source: '목업 경로(직선 거리 기준 추정)',
    checkedAt: '2026-10',
    confidence: 'C' as const,
  }
  if (mode === 'walk') return base
  const durationMin = Math.max(1, Math.round(distanceM / RIDE_M_PER_MIN[mode]))
  return {
    ...base,
    durationMin,
    // 대전 택시 기본요금 + 거리요금 어림값
    fareKrw: mode === 'taxi' ? Math.round((4800 + Math.max(0, distanceM - 1600) * 1.5) / 100) * 100 : undefined,
  }
}
