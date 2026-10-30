// 목업에서 거리·경로를 만들 때 쓰는 작은 계산. 실제 서비스의 거리는 서버(TMAP)가 준다.
import type { Coord } from '@/lib/contracts'

const EARTH_RADIUS_M = 6371008.8

export function haversineM([lng1, lat1]: Coord, [lng2, lat2]: Coord): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

export function pathLengthM(path: Coord[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) total += haversineM(path[i - 1], path[i])
  return Math.round(total)
}
