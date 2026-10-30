import { MAP_MAX_PITCH, MAP_PITCH_LIMITS } from './map-config'

// 줌에 따른 최대 기울기(도). 줌아웃한 채 많이 기울이면 지평선에 대전 밖이 보이므로 줌이 낮을수록 덜 기울게 한다
export function maxPitchForZoom(zoom: number, limits: [number, number][] = MAP_PITCH_LIMITS): number {
  const first = limits[0]
  const last = limits[limits.length - 1]
  if (zoom <= first[0]) return Math.min(first[1], MAP_MAX_PITCH)
  if (zoom >= last[0]) return Math.min(last[1], MAP_MAX_PITCH)
  for (let i = 1; i < limits.length; i++) {
    const [z1, p1] = limits[i]
    const [z0, p0] = limits[i - 1]
    if (zoom <= z1) return Math.min(p0 + ((p1 - p0) * (zoom - z0)) / (z1 - z0), MAP_MAX_PITCH)
  }
  return Math.min(last[1], MAP_MAX_PITCH)
}
