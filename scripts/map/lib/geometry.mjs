// 그림자·나무 계산에 쓰는 작은 기하 함수들. 좌표는 모두 미터 단위 평면 좌표 [x, y] 로 받는다.

// 같은 시드면 같은 수열이 나오는 난수(재실행해도 결과가 같게)
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 볼록 껍질(단조 사슬). 닫힌 고리(처음 = 끝)로 돌려준다
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])
  if (uniq.length < 3) return [...uniq, uniq[0]]
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  return [...hull, hull[0]]
}

// 그림자: 건물 바닥(여러 고리)을 해 반대편(bearingDeg, 북쪽 기준 시계 방향)으로 height × ratio 만큼 옮긴 것과 합쳐 볼록 껍질로 감싼다
export function shadowRing(rings, height, bearingDeg, ratio) {
  const len = height * ratio
  const rad = (bearingDeg * Math.PI) / 180
  const dx = Math.sin(rad) * len
  const dy = Math.cos(rad) * len
  const pts = []
  for (const ring of rings) for (const [x, y] of ring) pts.push([x, y], [x + dx, y + dy])
  return convexHull(pts)
}

export function ringArea(ring) {
  let s = 0
  for (let i = 0, n = ring.length - 1; i < n; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(s) / 2
}

export function pointInRing([x, y], ring) {
  let inside = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b]
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside
  }
  return inside
}

// 바깥 고리 안이고 구멍 밖이면 면 안
export function pointInPolygon(p, rings) {
  if (!pointInRing(p, rings[0])) return false
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i])) return false
  return true
}

// 면(미터 좌표) 안에 점을 흩뿌린다. 점끼리 minSpacing 이상 떨어지게(이미 놓인 점 occupied 와도), 면적 areaPerTree ㎡ 당 한 그루 정도
export function scatterInPolygon(rings, { rng, minSpacing, areaPerTree, occupied }) {
  const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const area = ringArea(rings[0]) - rings.slice(1).reduce((s, r) => s + ringArea(r), 0)
  const target = Math.floor(area / areaPerTree)
  const out = []
  const cell = minSpacing
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  const tooClose = (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [px, py] of occupied.get(`${cx + i},${cy + j}`) ?? []) {
        if ((px - x) ** 2 + (py - y) ** 2 < minSpacing * minSpacing) return true
      }
    }
    return false
  }
  for (let tries = 0; out.length < target && tries < target * 12 + 40; tries++) {
    const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0)
    if (!pointInPolygon([x, y], rings) || tooClose(x, y)) continue
    out.push([x, y])
    const k = key(x, y)
    if (!occupied.has(k)) occupied.set(k, [])
    occupied.get(k).push([x, y])
  }
  return out
}

// 나무가 건물 위에 놓이지 않게: 중심과 수관 둘레(radius) 위의 점들이 어떤 건물 바닥 안에도 없으면 true
export function isClearOfRings([x, y], radius, rings) {
  const probes = [[x, y]]
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    probes.push([x + Math.cos(a) * radius, y + Math.sin(a) * radius])
  }
  for (const ring of rings) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const [px, py] of ring) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py }
    if (x + radius < x0 || x - radius > x1 || y + radius < y0 || y - radius > y1) continue
    for (const p of probes) if (pointInRing(p, ring)) return false
  }
  return true
}
