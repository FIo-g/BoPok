// 지도 카메라가 웨이포인트를 순서대로 따라가는 반복 이동(첫 화면의 천천히 흐르는 평면, 둘러보기의 미끄러지는 이동)
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CameraView } from './map-types'

export type CameraLoop = {
  start: () => void
  // 지금 진행 중인 이동을 멈춘다(위치는 그대로). 다시 start 하면 현재 위치에서 다음 웨이포인트로 이어간다
  stop: () => void
  isRunning: () => boolean
}

// startIndex: 처음 이동할 웨이포인트(지금 카메라가 이미 첫 웨이포인트에 있으면 1 로 시작해서 제자리에서 기다리지 않게)
export function createCameraLoop(map: MapLibreMap, frames: CameraView[], durationMs: number, startIndex = 0): CameraLoop {
  let running = false
  let index = startIndex
  let token = 0

  const step = () => {
    if (!running) return
    const mine = ++token
    const v = frames[index % frames.length]
    map.once('moveend', () => {
      // 멈춤·새 이동으로 끝난 이동이면 이어가지 않는다
      if (mine !== token || !running) return
      index += 1
      step()
    })
    map.easeTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: durationMs, easing: t => t })
  }

  return {
    start() {
      if (running) return
      running = true
      step()
    },
    stop() {
      if (!running) return
      running = false
      token += 1
      map.stop()
    },
    isRunning: () => running,
  }
}

// 위도에 따라 달라지는 도 단위 거리(경도 방향 m → 도)
export function metersToLon(meters: number, lat: number) {
  return meters / (111320 * Math.cos((lat * Math.PI) / 180))
}
