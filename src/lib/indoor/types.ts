// 건물 안(홀) 시연용 개략도의 데이터 모양. 좌표는 모두 0~1 비율이다.
// 시연용: 지점 일부는 아직 확인 전이라 verified=false 로 표시하고, 화면에 "시연용 개략도"를 붙인다.
export type IndoorKind = 'entrance' | 'elevator' | 'stairs' | 'toilet' | 'rest' | 'seat'

export const INDOOR_KIND_TEXT: Record<IndoorKind, string> = {
  entrance: '입구·로비',
  elevator: '엘리베이터',
  stairs: '계단',
  toilet: '화장실',
  rest: '쉬는 곳',
  seat: '객석',
}

// 지점 색(아이콘). 입구 진회색 / 엘리베이터 파랑(사각) / 계단 주황 / 화장실 보라 / 쉬는 곳 세이지 / 객석 파랑 테두리 원
export const INDOOR_KIND_COLOR: Record<IndoorKind, string> = {
  entrance: '#3D3933',
  elevator: '#1D4ED8',
  stairs: '#EA580C',
  toilet: '#7C3AED',
  rest: '#6B8F5E',
  seat: '#1D4ED8',
}

export type Crop = { x: number; y: number; w: number; h: number }
export type Point = [number, number]

export type IndoorFloor = {
  level: number
  // 평면 그림에서 이 층만 잘라 보여 주는 영역. 층 이름 글자("LEVEL 3 · PLAN VIEW" 등)가 들어오지 않게 잡는다
  crop: Crop
  // 입체 분해도 그림에서 이 층을 누르는 영역(분해도 이미지 기준 0~1)
  hitPolygonOnExploded: Point[]
  // 분해도에서 층 이름 칩을 놓을 곳(분해도 이미지 기준 0~1)
  labelOnExploded: Point
}

export type IndoorNode = {
  id: string
  kind: IndoorKind
  level: number
  // 평면 crop 기준 0~1
  x: number
  y: number
  // 그림이나 현장으로 위치를 확인했는지. false 면 화면에 "위치 확인 전(시연용)"으로 표시한다
  verified: boolean
  label: string
}

export type IndoorEdge = {
  from: string
  to: string
  kind: 'walk' | 'stairs' | 'elevator'
  // 계단 칸 수(알 때만)
  stairs?: number
  // 이 구간의 거리 범위(m). 화면에는 "약 40~70m(추정)"처럼 범위로만 보인다
  meters?: [number, number]
}

export type IndoorSeatCount = { level: number; count: number; note?: string }

export type IndoorHall = {
  hallId: string
  name: string
  planImage: string
  explodedImage: string
  // 이미지 원본 크기(px). crop 의 가로세로 비를 정하는 데 쓴다
  imageSize: { w: number; h: number }
  floors: IndoorFloor[]
  seats: IndoorSeatCount[]
  nodes: IndoorNode[]
  edges: IndoorEdge[]
}
