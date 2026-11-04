// 대전예술의전당 아트홀·앙상블홀 실내 "시연용 개략도" 데이터.
// 그림은 건축 개략도이고 실제 배치와 다를 수 있다. 그림에 그려진 계단만 위치를 그대로 쓰고(verified: true),
// 엘리베이터·화장실·쉬는 곳·입구·객석 지점은 배치도에 없어 비워 두었다 — ?debug=indoor 편집기로 찍어 아래 nodes/edges 에 붙여 넣는다.
// 좌표: crop·hitPolygonOnExploded 는 각 그림 기준, nodes 는 층 평면 crop 기준(모두 0~1).
import type { IndoorHall, Point } from './types'

const W = 1920
const H = 1280
// 그림 원본 픽셀 좌표를 0~1 비율로(소수 셋째 자리)
const r3 = (n: number) => Math.round(n * 1000) / 1000
const poly = (pts: [number, number][]): Point[] => pts.map(([x, y]) => [r3(x / W), r3(y / H)])
const at = (x: number, y: number): Point => [r3(x / W), r3(y / H)]
const crop = (x: number, y: number, w: number, h: number) => ({ x: r3(x / W), y: r3(y / H), w: r3(w / W), h: r3(h / H) })

export const ARTS_CENTER_HALLS: IndoorHall[] = [
  {
    hallId: 'arthall',
    name: '아트홀',
    planImage: '/images/indoor/arts-center/arthall-plan.webp',
    explodedImage: '/images/indoor/arts-center/arthall-exploded.webp',
    imageSize: { w: W, h: H },
    // 평면 그림은 3층(위)·2층(가운데)·1층(아래)이 세로로 쌓여 있고 층 사이와 아래에 "LEVEL N · PLAN VIEW" 글자가 있다.
    // crop 은 글자(y≈36~62, 408~430, 1226~1248 픽셀)와 층 사이 점선을 피해 평면만 감싼다.
    floors: [
      {
        level: 1,
        crop: crop(440, 795, 1040, 420),
        hitPolygonOnExploded: poly([[360, 990], [380, 880], [540, 745], [640, 655], [1090, 652], [1335, 690], [1400, 740], [1500, 790], [1500, 1080], [1430, 1140], [1250, 1190], [1100, 1205], [700, 1195], [480, 1130]]),
        labelOnExploded: at(250, 990),
      },
      {
        level: 2,
        crop: crop(440, 440, 1040, 315),
        hitPolygonOnExploded: poly([[450, 472], [520, 420], [560, 395], [640, 370], [790, 365], [1000, 392], [1180, 420], [1335, 440], [1450, 520], [1490, 570], [1485, 615], [1450, 640], [1000, 642], [700, 605], [520, 540], [452, 500]]),
        labelOnExploded: at(330, 500),
      },
      {
        level: 3,
        crop: crop(440, 75, 1040, 320),
        hitPolygonOnExploded: poly([[445, 198], [520, 150], [615, 120], [640, 95], [1045, 92], [1240, 125], [1335, 200], [1450, 270], [1490, 320], [1480, 365], [1380, 382], [1000, 388], [700, 360], [520, 290], [448, 225]]),
        labelOnExploded: at(330, 215),
      },
    ],
    seats: [
      { level: 1, count: 1039, note: '오케스트라피트 125석 포함' },
      { level: 2, count: 229 },
      { level: 3, count: 278 },
    ],
    // 그림에 그려진 계단: 각 층 뒤쪽 2개 + 1층 무대 옆 1개. 위치는 그림에서 읽어 층 crop 기준 비율로 옮겼다.
    nodes: [
      { id: 'stairs-1-left', kind: 'stairs', level: 1, x: 0.271, y: 0.107, verified: true, label: '계단(뒤쪽 왼쪽)' },
      { id: 'stairs-1-right', kind: 'stairs', level: 1, x: 0.727, y: 0.107, verified: true, label: '계단(뒤쪽 오른쪽)' },
      { id: 'stairs-1-stage', kind: 'stairs', level: 1, x: 0.125, y: 0.714, verified: true, label: '계단(무대 옆)' },
      { id: 'stairs-2-left', kind: 'stairs', level: 2, x: 0.271, y: 0.143, verified: true, label: '계단(뒤쪽 왼쪽)' },
      { id: 'stairs-2-right', kind: 'stairs', level: 2, x: 0.727, y: 0.143, verified: true, label: '계단(뒤쪽 오른쪽)' },
      { id: 'stairs-3-left', kind: 'stairs', level: 3, x: 0.271, y: 0.125, verified: true, label: '계단(뒤쪽 왼쪽)' },
      { id: 'stairs-3-right', kind: 'stairs', level: 3, x: 0.727, y: 0.125, verified: true, label: '계단(뒤쪽 오른쪽)' },
    ],
    edges: [],
  },
  {
    hallId: 'ensemble',
    name: '앙상블홀',
    planImage: '/images/indoor/arts-center/ensemble-plan.webp',
    explodedImage: '/images/indoor/arts-center/ensemble-exploded.webp',
    imageSize: { w: W, h: H },
    // 평면 그림은 2층(위)과 1층(아래)이 위아래로 있고 글자는 없다.
    floors: [
      {
        level: 1,
        crop: crop(320, 570, 1260, 640),
        hitPolygonOnExploded: poly([[330, 935], [300, 900], [285, 820], [400, 680], [560, 600], [640, 575], [1280, 575], [1520, 620], [1640, 720], [1640, 820], [1600, 900], [1550, 990], [1380, 1080], [1000, 1160], [600, 1130], [385, 1010]]),
        labelOnExploded: at(200, 940),
      },
      {
        level: 2,
        crop: crop(320, 55, 1260, 445),
        hitPolygonOnExploded: poly([[345, 300], [470, 205], [740, 270], [960, 300], [1180, 270], [1450, 205], [1585, 300], [1625, 365], [1500, 470], [1150, 525], [760, 525], [420, 470], [345, 380]]),
        labelOnExploded: at(230, 330),
      },
    ],
    seats: [
      { level: 1, count: 504, note: '오케스트라피트 112석 포함' },
      { level: 2, count: 139 },
    ],
    // 그림에 그려진 계단: 1층 양옆
    nodes: [
      { id: 'stairs-1-left', kind: 'stairs', level: 1, x: 0.087, y: 0.594, verified: true, label: '계단(왼쪽 옆)' },
      { id: 'stairs-1-right', kind: 'stairs', level: 1, x: 0.921, y: 0.594, verified: true, label: '계단(오른쪽 옆)' },
    ],
    edges: [],
  },
]

export const hallById = (id: string): IndoorHall | undefined => ARTS_CENTER_HALLS.find(h => h.hallId === id)

// "3개 층 · 1층 1,039석(오케스트라피트 125석 포함) · 2층 229석 · 3층 278석"
export function hallSeatText(hall: IndoorHall): string {
  const parts = [...hall.seats].sort((a, b) => a.level - b.level).map(s => `${s.level}층 ${s.count.toLocaleString('ko-KR')}석${s.note ? `(${s.note})` : ''}`)
  return `${hall.floors.length}개 층 · ${parts.join(' · ')}`
}
