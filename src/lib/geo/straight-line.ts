import 'server-only'
import { CoordSchema, type Coord } from '@/lib/contracts'

// 후보를 추리는 직선거리다. 실제 경로·소요 시간은 TMAP과 보행 엔진이 별도로 구한다.
export function straightLineDistanceM(from: Coord, to: Coord): number {
  CoordSchema.parse(from)
  CoordSchema.parse(to)
  const rad = (value: number) => value * Math.PI / 180
  const a = Math.sin(rad(to[1] - from[1]) / 2) ** 2 + Math.cos(rad(from[1])) * Math.cos(rad(to[1])) *
    Math.sin(rad(to[0] - from[0]) / 2) ** 2
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a)))))
}

export function straightLineDetourM(from: Coord, via: Coord, to: Coord): number {
  return Math.max(0, straightLineDistanceM(from, via) + straightLineDistanceM(via, to) - straightLineDistanceM(from, to))
}
