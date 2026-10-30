// 지도 컴포넌트가 바깥과 주고받는 값. 지도 라이브러리 타입은 이 폴더 밖으로 나가지 않는다 (AGENTS.md 4장).
import type { FeatureCollection, LineString } from 'geojson'
import type { Coord } from '@/lib/contracts'

export type { Map as MapInstance } from 'maplibre-gl'

// 카메라 위치. center 는 [경도, 위도], 각도는 도
export type CameraView = { center: Coord; zoom: number; pitch: number; bearing: number }

// ok 조건 안 / warn 부담 / info 정보 부족(회색 점선)
export type RouteStatus = 'ok' | 'warn' | 'info'
// main 장소 안 길 / detour 우회로 / ride 탈것 구간(점선)
export type RouteRole = 'main' | 'detour' | 'ride'

export type RouteProps = {
  id: string
  // 목록 항목과 이어지는 id. 지도에서 누르면 이 값이 바깥으로 전달된다
  itemId: string
  role: RouteRole
  status: RouteStatus
  selected: boolean
  // 선 진하기 (구간만 보기에서 선택하지 않은 구간은 흐리게)
  emphasis: number
}

export type RouteCollection = FeatureCollection<LineString, RouteProps>

export type MapPinKind = 'start' | 'rest' | 'stairs' | 'toilet' | 'place' | 'stop'

export type MapPin = {
  id: string
  kind: MapPinKind
  coord: Coord
  label: string
  // start: 핀 안 글자(P, 버스), stop: 순서 번호
  text?: string
  indoor?: boolean
  // 누르면 바깥으로 전달할 목록 항목 id
  itemId?: string
}

// 경로가 모두 들어오는 범위 [서, 남, 동, 북]
export type Bounds = [number, number, number, number]
