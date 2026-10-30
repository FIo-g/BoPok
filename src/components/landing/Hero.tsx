'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACTIONS, BACK_FLY_MS, DRIFT_METERS, DRIFT_MS, EXIT, EXPLORE_VIEW, FLY_MS, GLYPH, GLYPH_SEEN, HINT_MS, INTRO_VIEW, LEAD,
  MAP_FILTER_MS, DRIFT_AFTER_EXTRAS_MS, EXTRAS_AFTER_INTRO_MS, prefetchTileUrls, MOBILE_MAX_WIDTH, READY_TIMEOUT_MS, PLACE_PINS, QUIET_MAP_FILTER, SEEN_KEY, TITLE_LINES, TITLE_TEXT, TOUR_MS, TOUR_RESUME_MS,
  TOUR_WAYPOINTS, VEIL, VEIL_FADE_MS, exitHalfMs, exitTotalMs, introTimeline,
} from './landing-intro'
import { BUILDINGS_TILES, LazyMapView, PALETTE, createCameraLoop, metersToLon, type CameraLoop, type MapInstance, type MapPin } from '@/components/map'
import './hero.css'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const hexToRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')
const veilBackground = `radial-gradient(${VEIL.shape}, rgba(${hexToRgb(PALETTE.background)}, ${VEIL.center}) 0%, rgba(${hexToRgb(PALETTE.background)}, ${VEIL.mid}) ${VEIL.midStop}%, rgba(${hexToRgb(PALETTE.background)}, 0) ${VEIL.end}%)`

const placePins: MapPin[] = PLACE_PINS.map(p => ({ id: p.id, kind: 'place', coord: p.coord, label: p.name }))

// 설명 문구는 줄 단위로 나타난다
const LEAD_LINES = ['주차장에서 입구, 관람길 계단까지 계산해서', '부모님이 편하게 걸을 수 있는 일정으로 고쳐드려요.']

type Phase = 'intro' | 'exploring'

export function Hero({ onStart }: { onStart: () => void }) {
  const heroRef = useRef<HTMLElement>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [arrived, setArrived] = useState(false)   // 둘러보기로 내려앉아 도착함
  const [homeReady, setHomeReady] = useState(true) // 첫 화면 위치로 돌아와 있음(돌아가는 중이면 false)
  const [flat, setFlat] = useState(true)          // true = 건물 높이 0 (평면 지도)
  const [ready, setReady] = useState(false)       // 지도가 자리 잡아서(또는 시간이 지나서) 글자 연출을 시작해도 됨
  const [introDone, setIntroDone] = useState(false) // 소개 연출이 끝남(그때부터 무거운 나무를 불러온다)
  const [driftOk, setDriftOk] = useState(false)     // 나무까지 자리 잡아서 평면 지도가 흘러도 됨
  const [colorOn, setColorOn] = useState(false)  // false = 색이 빠진 조용한 지도, true = 색이 돌아옴
  const [showHint, setShowHint] = useState(false)
  const [map, setMap] = useState<MapInstance | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const [active, setActive] = useState(true)      // 히어로가 화면에 보이는지
  const [compact, setCompact] = useState(false)   // 휴대폰
  const [seen, setSeen] = useState(false)         // 이번 탭에서 이미 한 번 봄
  const [titleKey, setTitleKey] = useState(0)

  const driftRef = useRef<CameraLoop | null>(null)
  const tourRef = useRef<CameraLoop | null>(null)
  const flight = useRef(0) // 카메라 이동 번호. 나중에 시작한 이동이 먼저 시작한 이동의 끝 처리를 덮어쓰지 않게
  const timers = useRef<number[]>([])
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  })

  // 다시 들어왔는지(sessionStorage), 휴대폰인지
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionStorage.getItem(SEEN_KEY)) setSeen(true)
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {}
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH - 1}px)`)
    const sync = () => setCompact(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // 히어로가 화면 밖이면 자동 이동과 글자 애니메이션을 멈춘다
  useEffect(() => {
    const el = heroRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  // 지도가 처음 다 그려져 한가해지면(idle) 글자 연출 시작
  const onMapReady = useCallback((m: MapInstance) => {
    setMap(m)
    m.once('idle', () => setReady(true))
  }, [])
  const onMapFail = useCallback(() => setMapFailed(true), [])
  // 지도가 늦거나 실패해도 글자는 보여야 한다
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), READY_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mapFailed) setReady(true)
  }, [mapFailed])

  // 카메라 이동 만들기
  useEffect(() => {
    if (!map) return
    const [lon, lat] = INTRO_VIEW.center
    driftRef.current = createCameraLoop(map, [
      { ...INTRO_VIEW, center: [lon + metersToLon(DRIFT_METERS, lat), lat] },
      INTRO_VIEW,
    ], DRIFT_MS)
    tourRef.current = createCameraLoop(map, TOUR_WAYPOINTS, TOUR_MS, 1) // 도착 지점이 첫 웨이포인트라 두 번째부터
    return () => {
      driftRef.current?.stop()
      tourRef.current?.stop()
    }
  }, [map])

  // 첫 화면: 평면 지도가 아주 천천히 흐른다 (화면에 보일 때만, 움직임 줄이기면 안 움직인다)
  useEffect(() => {
    const drift = driftRef.current
    if (!map || !drift) return
    // 글자가 내려오는 동안에는 지도를 가만히 둔다(카메라 이동과 글자 연출이 한꺼번에 일어나면 끊긴다)
    if (phase === 'intro' && homeReady && driftOk && active && !reduced()) drift.start()
    else drift.stop()
  }, [map, phase, homeReady, driftOk, active])

  // 둘러보기: 도착한 뒤 천천히 미끄러지듯 이동. 만지면 멈추고 TOUR_RESUME_MS 동안 안 만지면 이어간다
  const tourWanted = phase === 'exploring' && arrived && active && !showHint
  useEffect(() => {
    const tour = tourRef.current
    if (!map || !tour) return
    if (!tourWanted || reduced()) { tour.stop(); return }
    let resume: number | undefined
    let touching = false
    const pause = () => {
      touching = true
      window.clearTimeout(resume)
      tour.stop()
    }
    const release = () => {
      touching = false
      window.clearTimeout(resume)
      resume = window.setTimeout(() => { if (!touching) tour.start() }, TOUR_RESUME_MS)
    }
    const downs = ['mousedown', 'touchstart'] as const
    const ups = ['mouseup', 'touchend', 'touchcancel', 'dragend', 'rotateend'] as const
    downs.forEach(e => map.on(e, pause))
    ups.forEach(e => map.on(e, release))
    tour.start()
    return () => {
      window.clearTimeout(resume)
      downs.forEach(e => map.off(e, pause))
      ups.forEach(e => map.off(e, release))
      tour.stop()
    }
  }, [map, tourWanted])

  // 지도 둘러보기: 글자가 위로 빠지다가 절반쯤 빠졌을 때 지도 색이 돌아오기 시작하고 카메라가 내려앉는다
  const explore = () => {
    if (!map || phaseRef.current === 'exploring') return
    setPhase('exploring')
    const fast = reduced()
    later(() => {
      driftRef.current?.stop()
      setColorOn(true)
      setFlat(false) // 건물 높이 0 → 1 (카메라가 기울기 시작할 때부터)
      const mine = ++flight.current
      map.once('moveend', () => {
        if (mine !== flight.current) return // 도중에 '처음으로'를 눌렀으면 도착으로 치지 않는다
        setArrived(true)
        setShowHint(true)
        later(() => setShowHint(false), HINT_MS)
      })
      map.flyTo({ center: EXPLORE_VIEW.center, zoom: EXPLORE_VIEW.zoom, pitch: EXPLORE_VIEW.pitch, bearing: EXPLORE_VIEW.bearing, duration: fast ? 0 : FLY_MS, essential: true })
    }, fast ? 0 : exitHalfMs(TITLE_LINES))
  }

  // 처음으로: 카메라가 첫 화면 위치(평면)로 돌아가고 제목이 다시 내려앉는다
  const back = () => {
    if (!map) return
    tourRef.current?.stop()
    const mine = ++flight.current
    setArrived(false)
    setShowHint(false)
    setHomeReady(false)
    setColorOn(false) // 카메라가 돌아가는 동안 지도는 다시 색이 빠진다
    setPhase('intro')
    setTitleKey(k => k + 1)
    setSeen(true) // 다시 보는 제목은 짧게
    map.once('moveend', () => {
      if (mine !== flight.current) return
      setFlat(true)
      setHomeReady(true) // 도착한 뒤에야 평면 지도가 다시 흐르기 시작한다
    })
    map.flyTo({ center: INTRO_VIEW.center, zoom: INTRO_VIEW.zoom, pitch: INTRO_VIEW.pitch, bearing: INTRO_VIEW.bearing, duration: reduced() ? 0 : BACK_FLY_MS, essential: true })
  }

  // 등장 타임라인(다시 들어온 경우는 더 짧고 빠르게)
  const timing = seen ? GLYPH_SEEN : GLYPH
  const tl = useMemo(() => introTimeline(TITLE_LINES, timing, LEAD_LINES.length), [timing])
  // 글자 연출이 모두 끝난 뒤에 나무를 불러오고 평면 지도를 흐르게 한다
  const introEnd = tl.actionsDelay + ACTIONS.durationMs + ACTIONS.staggerMs + EXTRAS_AFTER_INTRO_MS
  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => setIntroDone(true), reduced() ? 0 : introEnd)
    return () => window.clearTimeout(id)
  }, [ready, introEnd])
  useEffect(() => {
    if (!introDone) return
    const id = window.setTimeout(() => setDriftOk(true), reduced() ? 0 : DRIFT_AFTER_EXTRAS_MS)
    return () => window.clearTimeout(id)
  }, [introDone])
  // 소개가 끝나면 둘러보기 도착 지점의 건물 타일을 미리 받아 둔다(없어도 둘러보기는 된다)
  useEffect(() => {
    if (!introDone || mapFailed) return
    for (const url of prefetchTileUrls(EXPLORE_VIEW, BUILDINGS_TILES)) fetch(url, { priority: 'low' } as RequestInit).catch(() => {})
  }, [introDone, mapFailed])
  // 퇴장 순서는 왼쪽 글자부터(둘째 줄은 첫 줄 뒤에 이어서)
  const exitOrder = useMemo(() => {
    let n = 0
    return TITLE_LINES.map(line => [...line].map(ch => (ch === ' ' ? 0 : n++)))
  }, [])

  const exploring = phase === 'exploring'
  const cssVars = {
    '--quiet-filter': QUIET_MAP_FILTER,
    '--filter-ms': `${MAP_FILTER_MS}ms`,
    '--veil-ms': `${VEIL_FADE_MS}ms`,
    '--g-ms': `${timing.durationMs}ms`,
    '--g-ease': timing.easing,
    '--g-rise': `${timing.riseEm}em`,
    '--g-blur': `${timing.blurPx}px`,
    '--lead-ms': `${LEAD.durationMs}ms`,
    '--lead-rise': `${LEAD.riseEm}px`,
    '--actions-ms': `${ACTIONS.durationMs}ms`,
    '--actions-rise': `${ACTIONS.risePx}px`,
    '--actions-stagger': `${ACTIONS.staggerMs}ms`,
    '--ad': `${tl.actionsDelay}ms`,
    '--x-ms': `${EXIT.durationMs}ms`,
    '--x-rise': `${EXIT.riseEm}em`,
    '--x-blur': `${EXIT.blurPx}px`,
    '--exit-total': `${exitTotalMs(TITLE_LINES)}ms`,
    '--hint-ms': `${HINT_MS}ms`,
  } as React.CSSProperties

  return (
    <section ref={heroRef} className="hero-root" data-active={active} data-phase={phase} data-color={colorOn} data-ready={ready} style={cssVars}>
      <div className="hero-map">
        <LazyMapView
          mode="landing"
          flat={flat}
          compact={compact}
          interactive={exploring && arrived}
          deferExtras={!(introDone || exploring)}
          initialView={INTRO_VIEW}
          pins={exploring && arrived ? placePins : []}
          onMapReady={onMapReady}
          onFail={onMapFail}
        />
      </div>
      <div className="hero-veil" data-hidden={exploring} style={{ background: veilBackground }} aria-hidden="true" />

      <div className="hero-copy" data-hidden={exploring} aria-hidden={exploring} inert={exploring}>
        <h1 key={titleKey} className="hero-title" aria-label={TITLE_TEXT}>
          {TITLE_LINES.map((line, li) => (
            <span key={li} className="hero-line" aria-hidden="true">
              {[...line].map((ch, i) => (ch === ' '
                ? <span key={i} className="hero-space" />
                : <span key={i} className="hero-glyph" style={{ '--d': `${tl.delays[li][i]}ms`, '--o': `${exitOrder[li][i] * EXIT.staggerMs}ms` } as React.CSSProperties}>{ch}</span>))}
            </span>
          ))}
        </h1>
        <p key={`lead-${titleKey}`} className="hero-lead">
          {LEAD_LINES.map((line, i) => <span key={i} className="hero-lead-line" style={{ '--ld': `${tl.leadDelays[i]}ms` } as React.CSSProperties}>{line}</span>)}
        </p>
        <div key={`actions-${titleKey}`} className="hero-actions">
          <button className="hero-start" onClick={onStart}>지금 시작하기</button>
          {map && !mapFailed && <button className="hero-explore" onClick={explore}>지도 둘러보기</button>}
        </div>
      </div>

      {exploring && (
        <>
          <button className="hero-back" onClick={back}>← 처음으로</button>
          <button className="hero-start-pill" onClick={onStart}>지금 시작하기</button>
        </>
      )}
      {showHint && (
        <div className="hero-hint" role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6.5 6.5 0 0 1-6.5 6.5h-1A6 6 0 0 1 6 17.8l-2.2-3.7a1.5 1.5 0 0 1 2.4-1.7L9 15.5" />
          </svg>
          끌어서 둘러보세요
        </div>
      )}
    </section>
  )
}
