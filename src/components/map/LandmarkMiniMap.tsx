'use client'

// 상세 화면의 위치 미니맵: 같은 지도 스타일을 작게, 움직이지 않게(스크롤·끌기 없음). 이 건물의 바닥을 파랑으로 세우고 바닥에 옅은 글로우, 파란 점 하나(라벨 없음).
// 패널이 열릴 때 만들어지고 닫히면 react-map-gl 이 지도를 remove() 한다. WebGL 이 없으면 주소 글자로 대신한다.
import { useMemo, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import Map, { Layer, Marker, Source } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { landmarkCenter, landmarkRectCoords, type Landmark } from './landmarks'
import {
  BUILDINGS_FALLBACK_H, BUILDINGS_MAX_ZOOM, BUILDINGS_MIN_ZOOM, BUILDINGS_SOURCE_LAYER, BUILDINGS_TILES, MAP_BG_COLOR, MAP_FONT_FAMILY,
  MAP_STYLE_URL, MAP_WORKER_URL, PALETTE,
} from './map-config'

maplibregl.setWorkerUrl(MAP_WORKER_URL)

const MINI_ZOOM = 15.2
const MINI_PITCH = 45
const HIGHLIGHT = '#1D4ED8'
const GLOW = '#93C5FD'
const HEIGHT: ExpressionSpecification = ['coalesce', ['get', 'h'], BUILDINGS_FALLBACK_H]
const CANVAS_ATTRIBUTES = { antialias: true }

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export default function LandmarkMiniMap({ landmark }: { landmark: Landmark }) {
  const [webgl] = useState(hasWebGL)
  const [lng, lat] = landmarkCenter(landmark)
  const point = useMemo(() => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [lng, lat] } }), [lng, lat])
  const rect = useMemo(() => {
    const ring = landmarkRectCoords(landmark)
    return ring ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } } : null
  }, [landmark])
  // 글로우 반지름(m)을 화면 픽셀로: 줌 10 에서의 픽셀 × 2^(줌-10)
  const glowRadius = useMemo<ExpressionSpecification>(() => {
    const meters = landmark.footprintLongM * 0.75
    const px10 = meters / ((78271.517 * Math.cos((lat * Math.PI) / 180)) / 1024)
    return ['interpolate', ['exponential', 2], ['zoom'], 10, px10, 20, px10 * 1024]
  }, [landmark.footprintLongM, lat])
  const highlightFilter = useMemo<ExpressionSpecification>(() => ['in', ['get', 'fid'], ['literal', landmark.hideFids]], [landmark.hideFids])
  const otherFilter = useMemo<ExpressionSpecification>(() => ['!', ['in', ['get', 'fid'], ['literal', landmark.hideFids]]], [landmark.hideFids])

  if (!webgl) {
    return <div className="mini-map-fallback" role="img" aria-label={`${landmark.name} 위치: ${landmark.area}`} style={{ background: MAP_BG_COLOR, width: '100%', height: '100%', display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center', color: '#5b564e', fontWeight: 700 }}>{landmark.area}</div>
  }
  return (
    <Map
      mapLib={maplibregl}
      mapStyle={MAP_STYLE_URL}
      initialViewState={{ longitude: lng, latitude: lat, zoom: MINI_ZOOM, pitch: MINI_PITCH, bearing: 0 }}
      interactive={false}
      attributionControl={{ compact: true }}
      canvasContextAttributes={CANVAS_ATTRIBUTES}
      localIdeographFontFamily={MAP_FONT_FAMILY}
      style={{ width: '100%', height: '100%', background: MAP_BG_COLOR }}
    >
      <Source id="mini-glow" type="geojson" data={point}>
        <Layer id="mini-glow-circle" type="circle" paint={{ 'circle-color': GLOW, 'circle-opacity': 0.5, 'circle-blur': 0.8, 'circle-radius': glowRadius, 'circle-pitch-alignment': 'map' }} />
      </Source>
      <Source id="mini-buildings" type="vector" tiles={[BUILDINGS_TILES]} minzoom={BUILDINGS_MIN_ZOOM} maxzoom={BUILDINGS_MAX_ZOOM}>
        <Layer id="mini-buildings-other" type="fill-extrusion" source-layer={BUILDINGS_SOURCE_LAYER} filter={otherFilter} paint={{ 'fill-extrusion-height': HEIGHT, 'fill-extrusion-base': 0, 'fill-extrusion-color': PALETTE.buildingLow, 'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient': false }} />
        {landmark.hideFids.length > 0 && (
          <Layer id="mini-buildings-highlight" type="fill-extrusion" source-layer={BUILDINGS_SOURCE_LAYER} filter={highlightFilter} paint={{ 'fill-extrusion-height': HEIGHT, 'fill-extrusion-base': 0, 'fill-extrusion-color': HIGHLIGHT, 'fill-extrusion-opacity': 0.85, 'fill-extrusion-vertical-gradient': false }} />
        )}
      </Source>
      {rect && (
        <Source id="mini-shape" type="geojson" data={rect}>
          <Layer id="mini-shape-fill" type="fill-extrusion" paint={{ 'fill-extrusion-height': 8, 'fill-extrusion-base': 0, 'fill-extrusion-color': HIGHLIGHT, 'fill-extrusion-opacity': 0.85, 'fill-extrusion-vertical-gradient': false }} />
        </Source>
      )}
      <Marker longitude={lng} latitude={lat} anchor="center">
        <div aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', background: HIGHLIGHT, border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
      </Marker>
    </Map>
  )
}
