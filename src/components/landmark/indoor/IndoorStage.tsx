'use client'

// 홀 실내 보기의 왼쪽 무대: 입체 분해도(층을 누르면 그 층 평면으로) / 층 평면(지점 아이콘과 경로).
// 평면은 이미지를 고치지 않고 층별 crop 으로 잘라 보여 준다(층 이름 글자 영역이 보이지 않게). 층 이름은 한글로 얹는다.
import { useEffect, useRef, useState } from 'react'
import { INDOOR_KIND_COLOR, INDOOR_KIND_TEXT, type IndoorKind, type IndoorNode } from '@/lib/indoor/types'
import { IndoorEditor, type EditorClick } from './IndoorEditor'
import { DRAW_MS, useIndoor } from './IndoorProvider'
import './indoor.css'

const ICON_PX = 11 // 아이콘 반지름(화면 px)
const ROUTE_PX = 5 // 경로 선 두께(화면 px)
const MAX_ZOOM = 2.5

// 그림 가운데에 놓은 상자의 실제 높이(px): SVG 좌표(viewBox 단위)를 화면 px 로 환산해 아이콘·선 굵기를 일정하게 유지한다
function useBoxHeight(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [height, setHeight] = useState(400)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight(el.clientHeight || 400)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return height
}

function NodeIcon({ node, ar, u, selected }: { node: IndoorNode; ar: number; u: number; selected: boolean }) {
  const cx = node.x * ar * 1000
  const cy = node.y * 1000
  const r = ICON_PX * u
  const color = INDOOR_KIND_COLOR[node.kind]
  const kindText = INDOOR_KIND_TEXT[node.kind]
  const label = `${node.label} · ${kindText}${node.verified ? '' : ' · 위치 확인 전(시연용)'}`
  return (
    <g role="img" aria-label={label} transform={`translate(${cx} ${cy})`} data-node-id={node.id}>
      <title>{node.verified ? `${node.label} (${kindText})` : `${node.label} (${kindText}) — 위치 확인 전(시연용)`}</title>
      {!node.verified && <circle r={r * 1.7} fill="none" stroke="#6b645a" strokeWidth={1.6 * u} strokeDasharray={`${4 * u} ${3 * u}`} />}
      {selected && <circle r={r * 1.5} fill="none" stroke="#1D4ED8" strokeWidth={2.4 * u} />}
      <Shape kind={node.kind} r={r} color={color} u={u} />
    </g>
  )
}

function Shape({ kind, r, color, u }: { kind: IndoorKind; r: number; color: string; u: number }) {
  const white = '#fff'
  switch (kind) {
    case 'elevator':
      return (
        <>
          <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.2} fill={color} />
          <path d={`M ${-r * 0.4} ${r * 0.25} L 0 ${-r * 0.4} L ${r * 0.4} ${r * 0.25} Z`} fill={white} />
        </>
      )
    case 'stairs':
      return (
        <>
          <circle r={r} fill={color} />
          <path d={`M ${-r * 0.55} ${r * 0.45} h ${r * 0.37} v ${-r * 0.37} h ${r * 0.37} v ${-r * 0.37} h ${r * 0.37}`} fill="none" stroke={white} strokeWidth={1.8 * u} strokeLinejoin="round" />
        </>
      )
    case 'toilet':
      return (
        <>
          <circle r={r} fill={color} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.95} fontWeight={800} fill={white}>WC</text>
        </>
      )
    case 'rest':
      return (
        <>
          <circle r={r} fill={color} />
          <path d={`M ${-r * 0.5} ${r * 0.2} h ${r} M ${-r * 0.4} ${r * 0.2} v ${-r * 0.4} h ${r * 0.8} v ${r * 0.4}`} fill="none" stroke={white} strokeWidth={1.8 * u} strokeLinecap="round" />
        </>
      )
    case 'seat':
      return <circle r={r} fill={white} stroke={color} strokeWidth={2.4 * u} />
    default:
      return (
        <>
          <circle r={r} fill={color} />
          <rect x={-r * 0.3} y={-r * 0.5} width={r * 0.6} height={r} rx={r * 0.1} fill={white} />
        </>
      )
  }
}

export function IndoorStage() {
  const indoor = useIndoor()
  const { hall, view, level, nodes, paths, playback, reducedMotion, debug } = indoor
  const floor = hall.floors.find(f => f.level === level) ?? hall.floors[0]
  const boxRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)

  const ar = view === 'plan' ? (floor.crop.w * hall.imageSize.w) / (floor.crop.h * hall.imageSize.h) : hall.imageSize.w / hall.imageSize.h
  const height = useBoxHeight(boxRef, [view, level, zoom, ar])
  // 층이나 보기가 바뀌면 확대는 1배로 돌아간다
  const zoomKey = `${view}-${level}`
  const [prevZoomKey, setPrevZoomKey] = useState(zoomKey)
  if (prevZoomKey !== zoomKey) {
    setPrevZoomKey(zoomKey)
    setZoom(1)
  }
  // 편집기(?debug=indoor): 평면을 누른 자리(0~1)를 편집기에 넘긴다
  const [click, setClick] = useState<EditorClick | null>(null)
  const onPlanClick = (e: React.MouseEvent) => {
    if (!debug) return
    const rect = e.currentTarget.getBoundingClientRect()
    setClick({ level, x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, seq: (click?.seq ?? 0) + 1 })
  }
  const u = 1000 / Math.max(height, 1) // 화면 1px 이 SVG 단위로 얼마인지

  // 모바일: 두 손가락으로 모아/벌려 평면을 1~2.5배로. 크게 하면 스크롤로 이동한다
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist
      setZoom(Math.min(MAX_ZOOM, Math.max(1, pinch.current.zoom * ratio)))
    }
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const levelNodes = nodes.filter(n => n.level === level)
  const kindsShown = [...new Set(levelNodes.map(n => n.kind))]
  const animateRoute = playback.active && !reducedMotion

  return (
    <div className="ind-stage" data-view={view}>
      <div className="ind-stageTop">
        {view === 'plan' && (
          <>
            <button type="button" className="ind-backBtn" onClick={indoor.backToExploded}>← 입체로 보기</button>
            <div className="ind-floorChips" role="group" aria-label="층 선택">
              {[...hall.floors].sort((a, b) => a.level - b.level).map(f => (
                <button key={f.level} type="button" className="ind-floorChip" aria-pressed={f.level === level} onClick={() => indoor.selectLevel(f.level)}>{f.level}층</button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="ind-zoomWrap" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        {view === 'exploded' ? (
          <div ref={boxRef} key="exploded" className="ind-box ind-swap" style={{ '--ar': ar, '--zoom': zoom } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hall.explodedImage} alt={`${hall.name} 입체 분해도(시연용 개략도)`} draggable={false} />
            <svg className="ind-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={`${hall.name} 층 선택`}>
              {hall.floors.map(f => (
                <polygon
                  key={f.level}
                  className="ind-hit"
                  points={f.hitPolygonOnExploded.map(p => p.join(',')).join(' ')}
                  role="button"
                  tabIndex={0}
                  aria-label={`${f.level}층 평면 보기`}
                  onClick={() => indoor.openPlan(f.level)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      indoor.openPlan(f.level)
                    }
                  }}
                />
              ))}
            </svg>
            {hall.floors.map(f => (
              <span key={f.level} className="ind-floorLabel" style={{ left: `${f.labelOnExploded[0] * 100}%`, top: `${f.labelOnExploded[1] * 100}%` }} aria-hidden="true">{f.level}층</span>
            ))}
          </div>
        ) : (
          <div ref={boxRef} key={`plan-${level}`} className="ind-box ind-planIn" style={{ '--ar': ar, '--zoom': zoom } as React.CSSProperties} data-plan-box onClick={onPlanClick}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hall.planImage}
              alt={`${hall.name} ${floor.level}층 평면(시연용 개략도)`}
              draggable={false}
              className="ind-planImg"
              style={{ width: `${100 / floor.crop.w}%`, height: `${100 / floor.crop.h}%`, left: `${(-floor.crop.x / floor.crop.w) * 100}%`, top: `${(-floor.crop.y / floor.crop.h) * 100}%` }}
            />
            <svg className="ind-overlay" viewBox={`0 0 ${ar * 1000} 1000`} preserveAspectRatio="xMidYMid meet">
              {paths.map((path, i) => {
                if (path.length < 2) return null
                const d = path.map((n, k) => `${k === 0 ? 'M' : 'L'} ${n.x * ar * 1000} ${n.y * 1000}`).join(' ')
                const end = path[path.length - 1]
                return (
                  <g key={`${playback.drawKey}-${i}`}>
                    <path d={d} pathLength={1} className="ind-route" data-animated={animateRoute} strokeWidth={ROUTE_PX * u} style={{ '--draw': `${DRAW_MS}ms` } as React.CSSProperties} />
                    <circle cx={end.x * ar * 1000} cy={end.y * 1000} r={ROUTE_PX * 1.6 * u} className="ind-routeEnd" />
                    {!reducedMotion && <circle cx={end.x * ar * 1000} cy={end.y * 1000} r={ROUTE_PX * 1.6 * u} className="ind-pulse" data-animated={animateRoute} style={{ '--draw': `${DRAW_MS}ms` } as React.CSSProperties} />}
                  </g>
                )
              })}
              {levelNodes.map(n => <NodeIcon key={n.id} node={n} ar={ar} u={u} selected={false} />)}
            </svg>
          </div>
        )}
      </div>

      {view === 'plan' && kindsShown.length > 0 && (
        <ul className="ind-legend" aria-label="이 층의 지점 종류">
          {kindsShown.map(kind => (
            <li key={kind}><span className="ind-legendDot" style={{ background: INDOOR_KIND_COLOR[kind] }} aria-hidden="true" />{INDOOR_KIND_TEXT[kind]}</li>
          ))}
          {levelNodes.some(n => !n.verified) && <li><span className="ind-legendDashed" aria-hidden="true" />위치 확인 전(시연용)</li>}
        </ul>
      )}
      <span className="ind-demoChip">시연용 개략도</span>
      {debug && view === 'plan' && <IndoorEditor click={click} ar={ar} />}
    </div>
  )
}
