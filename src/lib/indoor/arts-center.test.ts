import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARTS_CENTER_HALLS, hallById, hallSeatText } from './arts-center'
import { findRoute } from './route'

const inUnit = (n: number) => n >= 0 && n <= 1

describe('대전예술의전당 실내 시연용 개략도 데이터', () => {
  it('아트홀(3개 층)과 앙상블홀(2개 층)이 있다', () => {
    expect(ARTS_CENTER_HALLS.map(h => [h.hallId, h.floors.length])).toEqual([['arthall', 3], ['ensemble', 2]])
  })

  it('좌석 수가 정해진 값과 같다', () => {
    expect(hallSeatText(hallById('arthall')!)).toBe('3개 층 · 1층 1,039석(오케스트라피트 125석 포함) · 2층 229석 · 3층 278석')
    expect(hallSeatText(hallById('ensemble')!)).toBe('2개 층 · 1층 504석(오케스트라피트 112석 포함) · 2층 139석')
  })

  it('crop·폴리곤·지점 좌표가 모두 0~1 안이고 crop 이 그림 밖으로 나가지 않는다', () => {
    for (const hall of ARTS_CENTER_HALLS) {
      for (const floor of hall.floors) {
        const { x, y, w, h } = floor.crop
        expect([x, y, w, h].every(inUnit)).toBe(true)
        expect(x + w).toBeLessThanOrEqual(1)
        expect(y + h).toBeLessThanOrEqual(1)
        expect(floor.hitPolygonOnExploded.length).toBeGreaterThanOrEqual(3)
        for (const [px, py] of floor.hitPolygonOnExploded) expect(inUnit(px) && inUnit(py)).toBe(true)
        expect(floor.labelOnExploded.every(inUnit)).toBe(true)
      }
      for (const n of hall.nodes) expect(inUnit(n.x) && inUnit(n.y)).toBe(true)
    }
  })

  it('아트홀 평면 crop 은 "LEVEL N · PLAN VIEW" 글자 영역(픽셀 y 36~62, 408~430, 1226~1248)을 포함하지 않는다', () => {
    const H = 1280
    const labelBands: [number, number][] = [[36, 62], [408, 430], [1226, 1248]]
    for (const floor of hallById('arthall')!.floors) {
      const top = floor.crop.y * H
      const bottom = (floor.crop.y + floor.crop.h) * H
      for (const [a, b] of labelBands) expect(bottom <= a || top >= b, `층 ${floor.level}: ${top}~${bottom} 와 글자 ${a}~${b}`).toBe(true)
    }
  })

  it('층 이름·좌석 수가 층마다 하나씩 있다', () => {
    for (const hall of ARTS_CENTER_HALLS) {
      expect(hall.seats.map(s => s.level).sort()).toEqual(hall.floors.map(f => f.level).sort())
    }
  })

  it('처음에는 그림에 그려진 계단만 verified true 로 넣었다(아트홀 7개, 앙상블홀 2개)', () => {
    expect(hallById('arthall')!.nodes).toHaveLength(7)
    expect(hallById('ensemble')!.nodes).toHaveLength(2)
    for (const hall of ARTS_CENTER_HALLS) {
      expect(hall.nodes.every(n => n.kind === 'stairs' && n.verified)).toBe(true)
      expect(hall.edges).toEqual([])
    }
  })

  it('지점 id 는 홀 안에서 겹치지 않는다', () => {
    for (const hall of ARTS_CENTER_HALLS) expect(new Set(hall.nodes.map(n => n.id)).size).toBe(hall.nodes.length)
  })

  it('이미지 4장이 있고 400KB 이하이며 긴 변이 1920px 이다', () => {
    for (const hall of ARTS_CENTER_HALLS) {
      for (const image of [hall.planImage, hall.explodedImage]) {
        const file = path.join(__dirname, '../../../public', image)
        expect(fs.existsSync(file)).toBe(true)
        expect(fs.statSync(file).size).toBeLessThanOrEqual(400 * 1024)
      }
    }
  })

  it('데이터가 비어 있는 지금은 어느 층 객석이든 "실내 경로 정보 준비 중"(no-data)이다', () => {
    for (const hall of ARTS_CENTER_HALLS) {
      for (const floor of hall.floors) {
        expect(findRoute(hall, floor.level, 'nostairs')).toEqual({ status: 'no-data' })
        expect(findRoute(hall, floor.level, 'shortest')).toEqual({ status: 'no-data' })
      }
    }
  })
})
