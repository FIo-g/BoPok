import { describe, expect, it } from 'vitest'
// 전처리 스크립트가 쓰는 함수들 (그림자·나무)
import { convexHull, isClearOfRings, mulberry32, pointInPolygon, ringArea, scatterInPolygon, shadowRing } from '../../../scripts/map/lib/geometry.mjs'

type P = [number, number]
const square = (x: number, y: number, s: number): P[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]

describe('convexHull', () => {
  it('안쪽 점은 버리고 바깥 점만 남긴다', () => {
    const hull = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [3, 7]])
    expect(hull).toHaveLength(5) // 네 모서리 + 닫는 점
    expect(ringArea(hull)).toBeCloseTo(100)
  })
})

describe('shadowRing', () => {
  it('북동쪽(40도)으로 h×0.8 만큼 늘어난다', () => {
    const ring = shadowRing([square(0, 0, 10)], 10, 40, 0.8)
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1])
    expect(Math.max(...xs)).toBeCloseTo(10 + 8 * Math.sin((40 * Math.PI) / 180))
    expect(Math.max(...ys)).toBeCloseTo(10 + 8 * Math.cos((40 * Math.PI) / 180))
    expect(Math.min(...xs)).toBeCloseTo(0) // 반대쪽은 그대로
    expect(Math.min(...ys)).toBeCloseTo(0)
  })

  it('원래 바닥 도형을 모두 덮는다', () => {
    const ring = shadowRing([square(0, 0, 10)], 20, 40, 0.8)
    for (const p of square(0, 0, 10)) expect(pointInPolygon(p, [ring]) || ring.some(q => q[0] === p[0] && q[1] === p[1])).toBe(true)
  })

  it('높이가 0 이면 바닥 도형 그대로', () => {
    expect(ringArea(shadowRing([square(0, 0, 10)], 0, 40, 0.8))).toBeCloseTo(100)
  })
})

describe('scatterInPolygon', () => {
  const park = [square(0, 0, 200)]
  const run = (seed: number) => scatterInPolygon(park, { rng: mulberry32(seed), minSpacing: 12, areaPerTree: 400, occupied: new Map() })

  it('같은 시드면 같은 결과', () => {
    expect(run(7)).toEqual(run(7))
    expect(run(7)).not.toEqual(run(8))
  })

  it('면 안에서만, 최소 간격 12m 이상으로 놓는다', () => {
    const pts = run(1)
    expect(pts.length).toBeGreaterThan(40) // 200×200 / 400 = 100 그루 목표
    for (const p of pts) expect(pointInPolygon(p, park)).toBe(true)
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThanOrEqual(12)
    }
  })

  it('구멍(연못 등) 안에는 놓지 않는다', () => {
    const withHole = [square(0, 0, 200), square(50, 50, 100)]
    for (const p of scatterInPolygon(withHole, { rng: mulberry32(3), minSpacing: 12, areaPerTree: 400, occupied: new Map() })) {
      expect(pointInPolygon(p, withHole)).toBe(true)
    }
  })
})

describe('isClearOfRings', () => {
  const building = [square(0, 0, 10)]
  it('건물 위나 수관이 건물에 닿으면 false', () => {
    expect(isClearOfRings([5, 5], 3, building)).toBe(false)
    expect(isClearOfRings([12, 5], 3, building)).toBe(false) // 중심은 밖이지만 수관이 건물에 걸침
  })
  it('충분히 떨어지면 true', () => {
    expect(isClearOfRings([20, 5], 3, building)).toBe(true)
    expect(isClearOfRings([5, 5], 3, [])).toBe(true)
  })
})
