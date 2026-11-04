// 둘러보기 이름표 레이어 값. 점(circle)과 이름(symbol) 두 레이어를 GeoJSON 한 원본으로 그린다.
// DOM 마커 대신 레이어로 그리는 이유: 관광지가 190곳이라 마커를 그대로 두면 지도가 버벅인다.
import type { CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import type { MapLabel } from './map-types'

export const LABEL_SOURCE_ID = 'map-labels'
export const LABEL_DOT_LAYER_ID = 'map-labels-dot'
export const LABEL_TEXT_LAYER_ID = 'map-labels-text'
export const LABEL_LAYER_IDS = [LABEL_DOT_LAYER_ID, LABEL_TEXT_LAYER_ID]

export type LabelProps = { id: string; name: string; emphasis: MapLabel['emphasis'] }

export function labelsGeoJSON(labels: MapLabel[]): FeatureCollection<Point, LabelProps> {
  return {
    type: 'FeatureCollection',
    features: labels.map(label => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: label.coord },
      properties: { id: label.id, name: label.name, emphasis: label.emphasis },
    })),
  }
}

// 점: 랜드마크는 파란 큰 점, 관광지는 흰 점
export const labelDotLayer: CircleLayerSpecification = {
  id: LABEL_DOT_LAYER_ID,
  type: 'circle',
  source: LABEL_SOURCE_ID,
  paint: {
    'circle-radius': ['match', ['get', 'emphasis'], 'landmark', 6.5, 4.5],
    'circle-color': ['match', ['get', 'emphasis'], 'landmark', '#2563EB', '#FFFFFF'],
    'circle-stroke-color': ['match', ['get', 'emphasis'], 'landmark', '#FFFFFF', '#4B5563'],
    'circle-stroke-width': 1.5,
  },
}

// 이름: 점 아래쪽에 쓴다. 겹치면 MapLibre 가 숨긴다(text-allow-overlap 기본 false).
// symbol-sort-key 로 랜드마크를 먼저 배치해서 랜드마크 이름이 관광지 이름에 밀리지 않게 한다
export const labelTextLayer: SymbolLayerSpecification = {
  id: LABEL_TEXT_LAYER_ID,
  type: 'symbol',
  source: LABEL_SOURCE_ID,
  layout: {
    'text-field': ['get', 'name'],
    // 지도 스타일이 쓰는 글꼴(Noto Sans)의 굵은 글씨·보통 글씨. 한글은 지도 스타일과 같은 방식으로 나온다
    'text-font': ['case', ['==', ['get', 'emphasis'], 'landmark'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
    'text-size': ['match', ['get', 'emphasis'], 'landmark', 16, 13],
    'text-anchor': 'top',
    'text-offset': [0, 0.9],
    'text-max-width': 7,
    'text-allow-overlap': false,
    'symbol-sort-key': ['match', ['get', 'emphasis'], 'landmark', 0, 1],
  },
  paint: {
    'text-color': ['match', ['get', 'emphasis'], 'landmark', '#1E3A8A', '#3F3F46'],
    'text-halo-color': '#FFFFFF',
    'text-halo-width': ['match', ['get', 'emphasis'], 'landmark', 2, 1.6],
    'text-halo-blur': 0.5,
  },
}
