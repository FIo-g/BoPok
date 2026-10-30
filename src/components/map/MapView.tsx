'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, ExpressionSpecification, FillExtrusionLayerSpecification, FillLayerSpecification } from 'maplibre-gl'
import Map, { Layer, Marker, Source, type LayerProps, type MapRef } from 'react-map-gl/maplibre'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { TreesLayer } from './treesLayer'
import { maxPitchForZoom } from './map-limits'
import { crossingBearing, focusZone, nearBuildingIds, veilPolygon } from './map-focus'
import type { Coord } from '@/lib/contracts'
import type { Bounds, CameraView, MapPin, RouteCollection } from './map-types'
import {
  MAP_BEARING, MAP_BG_COLOR, MAP_CENTER, MAP_FLAT_DURATION_MS, MAP_FONT_FAMILY,
  MAP_MAX_BOUNDS, MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_PITCH, MAP_STYLE_URL, MAP_WORKER_URL, MAP_ZOOM,
  BUILDINGS_BEFORE_ID, BUILDINGS_FALLBACK_H, BUILDINGS_FAR_LAYER_ID, BUILDINGS_NEAR_LAYER_ID, BUILDINGS_MAX_ZOOM, BUILDINGS_MIN_ZOOM, BUILDINGS_SOURCE_ID, BUILDINGS_SOURCE_LAYER, BUILDINGS_TILES,
  FAR_COLOR, FAR_HEIGHT_SCALE, FAR_OPACITY, FOCUS_MOVE_MS, FOCUS_PITCH, FOCUS_RISE_MS, VEIL_OPACITY, VEIL_SOURCE_ID,
  BUILDINGS_SHADOW_FAR_LAYER_ID, BUILDINGS_SHADOW_NEAR_LAYER_ID, BUILDINGS_SHADOW_SOURCE_LAYER, PALETTE, SHADOW_FAR_OPACITY, SHADOW_OPACITY,
  TREES_URL, BOUNDARY_GLOW, BOUNDARY_LINE, BOUNDARY_SOURCE_ID, BOUNDARY_URL, MAP_MAX_PITCH, MASK_SOURCE_ID, MASK_URL,
  ROUTE_BEFORE_ID, ROUTE_COLORS, ROUTE_SOURCE_ID,
  PIXEL_RATIO_MAX, PIXEL_RATIO_MAX_COMPACT, RISE_ZOOM,
} from './map-config'

maplibregl.setWorkerUrl(MAP_WORKER_URL)

// 높이는 전처리에서 계산한 h(m)만 읽는다. 색은 층수가 있으면 층수, 없으면 높이로 어림해서 1층 크림 → 15층 연회색 → 30층 이상 연파랑
// fill-extrusion 의 진하기는 레이어 단위라서 건물을 near(선명)/far(흐리고 낮게) 두 레이어로 나누고 filter 로 fid 를 나눈다.
// 레이어는 한 번만 만들고, 높이 배율은 setPaintProperty 로만 바꾼다(솟아오르는 연출).
const HEIGHT: ExpressionSpecification = ['coalesce', ['get', 'h'], BUILDINGS_FALLBACK_H]
const heightScaled = (scale: number): ExpressionSpecification => ['*', HEIGHT, scale]
// landing: 줌이 RISE_ZOOM 구간을 지나는 동안 0 → 1. 줌으로 보간하는 식이라 줌이 바뀔 때 GPU 가 처리한다(setPaintProperty 를 프레임마다 부르지 않는다)
const heightByZoom = (scale: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], RISE_ZOOM[0], ['*', HEIGHT, 0], RISE_ZOOM[1], ['*', HEIGHT, scale]]
const nearLayer: FillExtrusionLayerSpecification = {
  id: BUILDINGS_NEAR_LAYER_ID,
  type: 'fill-extrusion',
  source: BUILDINGS_SOURCE_ID,
  'source-layer': BUILDINGS_SOURCE_LAYER,
  minzoom: BUILDINGS_MIN_ZOOM,
  paint: {
    'fill-extrusion-height': heightScaled(1),
    'fill-extrusion-base': 0,
    'fill-extrusion-color': [
      'case', ['==', ['get', 'd'], 1], PALETTE.buildingDefault,
      ['interpolate', ['linear'], HEIGHT, 4, PALETTE.buildingLow, 60, PALETTE.buildingHigh],
    ],
    // 아래쪽이 어두워지는 효과는 끈다(파스텔 질감)
    'fill-extrusion-vertical-gradient': false,
    'fill-extrusion-opacity': 1,
  },
}
const farLayer: FillExtrusionLayerSpecification = {
  id: BUILDINGS_FAR_LAYER_ID,
  type: 'fill-extrusion',
  source: BUILDINGS_SOURCE_ID,
  'source-layer': BUILDINGS_SOURCE_LAYER,
  minzoom: BUILDINGS_MIN_ZOOM,
  paint: {
    'fill-extrusion-height': heightScaled(FAR_HEIGHT_SCALE),
    'fill-extrusion-base': 0,
    'fill-extrusion-color': FAR_COLOR,
    'fill-extrusion-vertical-gradient': false,
    'fill-extrusion-opacity': FAR_OPACITY,
  },
}
// 그림자: 건물 바닥 옆으로 늘어진 연보라 도형. 범위 밖(far) 건물의 그림자는 같이 흐려진다
const shadowNearLayer: FillLayerSpecification = {
  id: BUILDINGS_SHADOW_NEAR_LAYER_ID, type: 'fill', source: BUILDINGS_SOURCE_ID, 'source-layer': BUILDINGS_SHADOW_SOURCE_LAYER, minzoom: BUILDINGS_MIN_ZOOM,
  paint: { 'fill-color': PALETTE.shadow, 'fill-opacity': SHADOW_OPACITY, 'fill-antialias': true },
}
const shadowFarLayer: FillLayerSpecification = {
  id: BUILDINGS_SHADOW_FAR_LAYER_ID, type: 'fill', source: BUILDINGS_SOURCE_ID, 'source-layer': BUILDINGS_SHADOW_SOURCE_LAYER, minzoom: BUILDINGS_MIN_ZOOM,
  paint: { 'fill-color': PALETTE.shadow, 'fill-opacity': SHADOW_FAR_OPACITY, 'fill-antialias': true },
}
const veilLayer: FillLayerSpecification = { id: 'focus-veil', type: 'fill', source: VEIL_SOURCE_ID, paint: { 'fill-color': PALETTE.background, 'fill-opacity': VEIL_OPACITY } }
// 건물 가장자리를 부드럽게(maplibre 기본값은 antialias: false)
const CANVAS_ATTRIBUTES = { antialias: true }
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

// 경로 선 레이어. line-dasharray 는 데이터로 바꿀 수 없어서 점선/실선을 레이어로 나눈다.
const isMain: ExpressionSpecification = ['==', ['get', 'role'], 'main']
const isDetour: ExpressionSpecification = ['==', ['get', 'role'], 'detour']
const isRide: ExpressionSpecification = ['==', ['get', 'role'], 'ride']
const isInfo: ExpressionSpecification = ['all', isMain, ['==', ['get', 'status'], 'info']]
const isSolidMain: ExpressionSpecification = ['all', isMain, ['!=', ['get', 'status'], 'info']]
const isLine: ExpressionSpecification = ['!', isRide]
const selected: ExpressionSpecification = ['==', ['get', 'selected'], true]

const routeLayers: LayerProps[] = [
  // 누르기 쉽게 투명한 두꺼운 선(폭 24px)
  { id: 'route-hit', type: 'line', source: ROUTE_SOURCE_ID, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 24, 'line-color': '#000000', 'line-opacity': 0.01 } },
  // 흰 테두리 (폭 9px, 선택되면 11px)
  { id: 'route-casing', type: 'line', source: ROUTE_SOURCE_ID, filter: isLine, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['case', selected, 11, 9], 'line-color': ROUTE_COLORS.casing, 'line-opacity': ['get', 'emphasis'] } },
  { id: 'route-ride', type: 'line', source: ROUTE_SOURCE_ID, filter: isRide, layout: { 'line-cap': 'butt' }, paint: { 'line-width': 2, 'line-color': ROUTE_COLORS.ride, 'line-dasharray': [1.5, 2], 'line-opacity': ['get', 'emphasis'] } },
  { id: 'route-info', type: 'line', source: ROUTE_SOURCE_ID, filter: isInfo, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': ['case', selected, 7, 5], 'line-color': ROUTE_COLORS.info, 'line-dasharray': [1.6, 1.2], 'line-opacity': ['get', 'emphasis'] } },
  { id: 'route-detour', type: 'line', source: ROUTE_SOURCE_ID, filter: isDetour, layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-width': ['case', selected, 7, 5], 'line-color': ROUTE_COLORS.ok, 'line-dasharray': [1.6, 1.2], 'line-opacity': ['get', 'emphasis'] } },
  { id: 'route-main', type: 'line', source: ROUTE_SOURCE_ID, filter: isSolidMain, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['case', selected, 7, 5], 'line-color': ['match', ['get', 'status'], 'warn', ROUTE_COLORS.warn, ROUTE_COLORS.ok], 'line-opacity': ['get', 'emphasis'] } },
]

const placeholder = { background: MAP_BG_COLOR, color: '#8A847B', display: 'grid', placeItems: 'center', fontSize: 13, textAlign: 'center' } as const

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function BenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ flex: 'none' }} aria-hidden="true" fill="none" stroke="#1D4ED8" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2.5 7h11M3.5 7v-2.5h9V7M4 7v5M12 7v5M2.5 10h11" />
    </svg>
  )
}

// 휴대폰에서 지도를 두 손가락으로 움직이라는 안내(협력 제스처) 한국어 문구
const COOPERATIVE_LOCALE = {
  'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl 키를 누른 채 스크롤하면 지도를 확대·축소해요',
  'CooperativeGesturesHandler.MacHelpText': '⌘ 키를 누른 채 스크롤하면 지도를 확대·축소해요',
  'CooperativeGesturesHandler.MobileHelpText': '두 손가락으로 지도를 움직이세요',
}

type Props = {
  // 'landing': S1 시작 화면 배경. 판정 경로·계단 핀은 그리지 않고, 카메라는 밖(onMapReady 로 받은 지도)에서 조종한다.
  // 스크롤로 확대·더블클릭 확대는 끄고(페이지 스크롤을 막지 않게), 끌어서 움직이기는 interactive 일 때만 켠다
  mode?: 'plan' | 'landing'
  // landing: 휴대폰. 두 손가락으로 지도 이동(협력 제스처), 나무·그림자 레이어 끔
  compact?: boolean
  // landing: 끌기·회전 허용
  interactive?: boolean
  // landing: 처음 카메라
  initialView?: CameraView
  onMapReady?: (map: MapLibreMap) => void
  // landing: true 인 동안은 나무(three.js)를 불러오지 않는다(첫 화면 연출이 끊기지 않게)
  deferExtras?: boolean
  flat?: boolean
  onFail?: () => void
  routes?: RouteCollection | null
  pins?: MapPin[]
  // 경로가 모두 들어오는 범위 [서, 남, 동, 북]. 전체 보기에서 카메라를 맞춘다
  fit?: Bounds | null
  // 값이 있으면 "구간만 보기": 이 경로 주변 건물만 선명하게 보여준다
  focusPath?: Coord[] | null
  // 지도에서 경로선이나 핀을 눌렀을 때. 목록 항목 id 가 온다
  onSelectItem?: (itemId: string) => void
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function MapView({ mode = 'plan', compact = false, interactive = false, initialView, onMapReady, deferExtras = false, flat = false, onFail, routes = null, pins = [], fit = null, focusPath = null, onSelectItem }: Props) {
  const landing = mode === 'landing'
  // 처음 높이 배율(평면으로 시작하면 처음부터 0 으로 만들어 3D 가 번쩍 보이지 않게). 한 번 정하면 바꾸지 않는다
  const [initialFlat] = useState(flat)
  const nearInit = useMemo<FillExtrusionLayerSpecification>(() => ({ ...nearLayer, paint: { ...nearLayer.paint, 'fill-extrusion-height': landing ? heightByZoom(1) : heightScaled(initialFlat ? 0 : 1) } }), [initialFlat, landing])
  // landing 그림자: 건물이 솟는 줌 구간에 맞춰 옅게 나타난다(visibility 를 바꾸지 않고 줌으로 보간)
  const shadowNearInit = useMemo<FillLayerSpecification>(() => (landing ? { ...shadowNearLayer, paint: { ...shadowNearLayer.paint, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], RISE_ZOOM[0], 0, RISE_ZOOM[1], SHADOW_OPACITY] } } : shadowNearLayer), [landing])
  const shadowFarInit = useMemo<FillLayerSpecification>(() => (landing ? { ...shadowFarLayer, paint: { ...shadowFarLayer.paint, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], RISE_ZOOM[0], 0, RISE_ZOOM[1], SHADOW_FAR_OPACITY] } } : shadowFarLayer), [landing])
  const farInit = useMemo<FillExtrusionLayerSpecification>(() => ({ ...farLayer, paint: { ...farLayer.paint, 'fill-extrusion-height': landing ? heightByZoom(FAR_HEIGHT_SCALE) : heightScaled(initialFlat ? 0 : FAR_HEIGHT_SCALE) } }), [initialFlat, landing])
  const mapRef = useRef<MapRef>(null)
  const firstFit = useRef(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(() => !hasWebGL())
  const [cursor, setCursor] = useState('')
  const treesRef = useRef<TreesLayer | null>(null)
  const flatRef = useRef(flat)
  const [nearIds, setNearIds] = useState<number[] | null>(null)

  useEffect(() => {
    if (failed) onFail?.()
  }, [failed, onFail])

  // 나무: three.js 커스텀 레이어(B안). 건물 레이어 다음, 도로·지명 앞에 끼운다. 못 불러와도 지도는 그대로 보인다
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || compact || deferExtras) return
    let cancelled = false
    let added: TreesLayer | null = null
    ;(async () => {
      try {
        const res = await fetch(TREES_URL)
        if (!res.ok) return
        const data = await res.json()
        const { createTreesLayer } = await import('./treesLayer')
        const layer = await createTreesLayer(data, landing ? { riseZoom: RISE_ZOOM } : undefined)
        if (cancelled) return
        layer.setVisible(landing || !flatRef.current)
        map.addLayer(layer, BUILDINGS_BEFORE_ID)
        treesRef.current = layer
        added = layer
      } catch {
        // 나무가 없어도 지도는 정상
      }
    })()
    return () => {
      cancelled = true
      if (added && map.getLayer(added.id)) map.removeLayer(added.id)
      treesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, compact, deferExtras])
  // 2D 보기에서는 나무를 숨긴다
  useEffect(() => {
    flatRef.current = flat
    // landing 은 나무가 줌에 따라 자라서(treesLayer 의 riseZoom) 보이고 숨기는 것을 따로 하지 않는다
    treesRef.current?.setVisible(landing || !flat)
  }, [flat, landing])

  // 구간 범위는 구간이 바뀔 때만 계산한다
  const zone = useMemo(() => (focusPath ? focusZone(focusPath) : null), [focusPath])
  const zoneKey = zone ? zone.bounds.join(',') : ''
  const veil = useMemo<FeatureCollection | Feature<Polygon>>(() => (zone ? veilPolygon(MAP_MAX_BOUNDS, zone) : EMPTY_FC), [zone])

  // 구간 주변 건물: 카메라가 멈추고 타일이 다 올라왔을 때(idle) 지금 불러온 타일 속 건물만 정밀 계산한다
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !loaded || !zone) return
    const compute = () => {
      if (!map.getSource(BUILDINGS_SOURCE_ID)) return
      const features = map.querySourceFeatures(BUILDINGS_SOURCE_ID, { sourceLayer: BUILDINGS_SOURCE_LAYER })
      const ids = nearBuildingIds({ features }, zone)
      setNearIds(prev => (prev && prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids))
    }
    map.on('idle', compute)
    return () => { map.off('idle', compute); setNearIds(null) }
  }, [zone, loaded])

  const nearFilter = useMemo<ExpressionSpecification>(
    () => (nearIds ? ['in', ['get', 'fid'], ['literal', nearIds]] : ['has', 'fid']),
    [nearIds],
  )
  const farFilter = useMemo<ExpressionSpecification>(
    () => (nearIds ? ['!', ['in', ['get', 'fid'], ['literal', nearIds]]] : ['==', ['get', 'fid'], -1]),
    [nearIds],
  )

  // 건물 높이 배율: 2D 는 평면(0), 구간만 보기로 바뀌면 near 건물이 0 → 1 로 솟아오른다
  useEffect(() => {
    const map = mapRef.current?.getMap()
    // landing 은 줌으로 보간하는 식(heightByZoom)이 높이를 정하므로 건드리지 않는다
    if (!map || !loaded || landing || !map.getLayer(BUILDINGS_NEAR_LAYER_ID)) return
    const setScale = (near: number, far: number) => {
      map.setPaintProperty(BUILDINGS_NEAR_LAYER_ID, 'fill-extrusion-height', heightScaled(near))
      map.setPaintProperty(BUILDINGS_FAR_LAYER_ID, 'fill-extrusion-height', heightScaled(far))
    }
    if (flat) { setScale(0, 0); return }
    // 구간만 보기에서는 0 → 1 로 솟아오른다
    if (!zone || reducedMotion()) { setScale(1, FAR_HEIGHT_SCALE); return }
    const riseMs = FOCUS_RISE_MS
    let raf = 0
    const start = performance.now()
    setScale(0, FAR_HEIGHT_SCALE)
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / riseMs)
      setScale(1 - (1 - t) ** 3, FAR_HEIGHT_SCALE) // ease-out
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // 솟아오르는 연출은 구간이 바뀔 때만 다시 시작한다(타일이 더 올라와 nearIds 가 갱신돼도 다시 시작하지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, zoneKey, loaded, landing])

  // 카메라: 전체 보기는 경로 전체, 구간만 보기는 구간 범위. 2D 는 항상 위에서 북쪽 기준
  const target = zone ? zone.bounds : fit
  const targetKey = target ? target.join(',') : ''
  const bearing = flat ? 0 : zone && focusPath ? crossingBearing(focusPath) : MAP_BEARING
  const pitch = flat ? 0 : zone ? FOCUS_PITCH : MAP_PITCH
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded || landing) return
    const duration = reducedMotion() || firstFit.current ? 0 : zone ? FOCUS_MOVE_MS : MAP_FLAT_DURATION_MS
    if (target) {
      map.fitBounds([[target[0], target[1]], [target[2], target[3]]], { padding: 48, maxZoom: 18, pitch, bearing, duration })
      firstFit.current = false
    } else {
      map.easeTo({ pitch, bearing, duration: reducedMotion() ? 0 : MAP_FLAT_DURATION_MS })
    }
    // target 배열이 아니라 값(targetKey)이 바뀔 때만 움직인다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, targetKey, pitch, bearing])

  // landing 은 문구 없이 바탕색만 보이게 한다(부모가 onFail 로 알아서 대체 화면을 보여준다)
  if (failed) return landing ? <div style={{ background: MAP_BG_COLOR, width: '100%', height: '100%' }} /> : <div style={{ ...placeholder, width: '100%', height: '100%' }} role="status">지도를 불러오지 못했어요. 목록으로 보여드릴게요</div>

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: MAP_BG_COLOR }}>
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={MAP_STYLE_URL}
        initialViewState={initialView ? { longitude: initialView.center[0], latitude: initialView.center[1], zoom: initialView.zoom, pitch: initialView.pitch, bearing: initialView.bearing } : { ...MAP_CENTER, zoom: MAP_ZOOM, pitch: MAP_PITCH, bearing: MAP_BEARING }}
        scrollZoom={!landing}
        doubleClickZoom={!landing}
        keyboard={!landing}
        dragPan={landing ? interactive : true}
        dragRotate={landing ? interactive : true}
        touchZoomRotate={landing ? interactive : true}
        touchPitch={landing ? interactive : true}
        cooperativeGestures={landing && compact}
        locale={COOPERATIVE_LOCALE}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        maxBounds={MAP_MAX_BOUNDS}
        maxPitch={MAP_MAX_PITCH}
        // 줌아웃할수록 덜 기울게: 줌이 바뀔 때마다 최대 기울기를 줌에 맞춘다(지금 기울기가 넘으면 maplibre 가 그 한도로 맞춰 준다)
        onZoom={e => e.target.setMaxPitch(maxPitchForZoom(e.viewState.zoom))}
        localIdeographFontFamily={MAP_FONT_FAMILY}
        attributionControl={{ compact: true }}
        canvasContextAttributes={CANVAS_ATTRIBUTES}
        interactiveLayerIds={routes ? ['route-hit'] : []}
        cursor={cursor}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('')}
        onClick={e => {
          const id = e.features?.[0]?.properties?.itemId
          if (typeof id === 'string') onSelectItem?.(id)
        }}
        onLoad={e => {
          e.target.setMaxPitch(maxPitchForZoom(e.target.getZoom()))
          // landing 은 화면 전체를 매 프레임 다시 그려서 해상도를 낮춘다(고해상도 휴대폰 보호)
          if (landing) e.target.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? PIXEL_RATIO_MAX_COMPACT : PIXEL_RATIO_MAX))
          setLoaded(true)
          onMapReady?.(e.target)
        }}
        // 지도가 뜨기 전에 난 오류(스타일·WebGL)만 실패로 본다. 타일 하나가 늦는 건 무시
        onError={() => { if (!loaded) setFailed(true) }}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id={BUILDINGS_SOURCE_ID} type="vector" tiles={[BUILDINGS_TILES]} minzoom={BUILDINGS_MIN_ZOOM} maxzoom={BUILDINGS_MAX_ZOOM}>
          {/* 그림자는 건물 레이어보다 아래. 2D 에서는 건물이 평면이라 그림자도 숨긴다 */}
          <Layer {...shadowNearInit} filter={nearFilter} layout={{ visibility: (!landing && flat) || compact ? 'none' : 'visible' }} beforeId={BUILDINGS_BEFORE_ID} />
          <Layer {...shadowFarInit} filter={farFilter} layout={{ visibility: (!landing && flat) || compact ? 'none' : 'visible' }} beforeId={BUILDINGS_BEFORE_ID} />
          <Layer {...nearInit} filter={nearFilter} beforeId={BUILDINGS_BEFORE_ID} />
          <Layer {...farInit} filter={farFilter} beforeId={BUILDINGS_BEFORE_ID} />
        </Source>
        {/* 구간 범위 밖을 흐리게 덮는 덮개. 범위 모양만 뚫려 있다 */}
        <Source id={VEIL_SOURCE_ID} type="geojson" data={veil}>
          <Layer {...veilLayer} beforeId={ROUTE_BEFORE_ID} />
        </Source>
        {routes && (
          <Source id={ROUTE_SOURCE_ID} type="geojson" data={routes}>
            {routeLayers.map(layer => <Layer key={layer.id} {...layer} beforeId={ROUTE_BEFORE_ID} />)}
          </Source>
        )}
        {/* 대전 밖 덮기: 세계 전체에서 대전 경계를 뚫은 도형을 바탕색으로 */}
        <Source id={MASK_SOURCE_ID} type="geojson" data={MASK_URL}>
          <Layer id="daejeon-mask" type="fill" paint={{ 'fill-color': PALETTE.background, 'fill-opacity': 1 }} />
        </Source>
        <Source id={BOUNDARY_SOURCE_ID} type="geojson" data={BOUNDARY_URL}>
          <Layer id="daejeon-boundary-glow" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': BOUNDARY_GLOW.color, 'line-width': BOUNDARY_GLOW.width, 'line-blur': BOUNDARY_GLOW.blur, 'line-opacity': BOUNDARY_GLOW.opacity }} />
          <Layer id="daejeon-boundary-line" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': BOUNDARY_LINE.color, 'line-width': BOUNDARY_LINE.width }} />
        </Source>
        {pins.map(pin => (
          <Marker key={pin.id} longitude={pin.coord[0]} latitude={pin.coord[1]} anchor={pin.kind === 'stairs' ? 'bottom' : 'center'} style={{ zIndex: pin.kind === 'stairs' ? 4 : pin.kind === 'stop' ? 3 : 2 }}>
            {pin.kind === 'place' ? (
              <div className="map-pin pin-place" role="img" aria-label={pin.label}><span className="pin-dot" /><span className="pin-name">{pin.label}</span></div>
            ) : pin.kind === 'stairs' ? (
              <button type="button" className="map-pin pin-stairs" style={{ width: 'max-content' }} onClick={e => { e.stopPropagation(); if (pin.itemId) onSelectItem?.(pin.itemId) }}>{pin.label}</button>
            ) : pin.kind === 'start' ? (
              <div className="map-pin pin-start" style={{ width: 'max-content' }} role="img" aria-label={pin.label}>{pin.text ?? 'P'}</div>
            ) : pin.kind === 'stop' ? (
              <button type="button" className="map-pin pin-stop" aria-label={pin.label} title={pin.label} onClick={e => { e.stopPropagation(); if (pin.itemId) onSelectItem?.(pin.itemId) }}>{pin.text}</button>
            ) : pin.kind === 'toilet' ? (
              <div className="map-pin pin-toilet" style={{ width: 'max-content' }} role="img" aria-label={`화장실: ${pin.label}`}>WC</div>
            ) : (
              <div className="map-pin pin-rest" style={{ width: 'max-content' }} role="img" aria-label={`쉼터: ${pin.label}`}>
                <BenchIcon />
                {pin.indoor && <small>실내</small>}
              </div>
            )}
          </Marker>
        ))}
      </Map>
      {!loaded && !landing && <div style={{ ...placeholder, position: 'absolute', inset: 0 }} role="status">지도를 불러오는 중이에요</div>}
    </div>
  )
}
