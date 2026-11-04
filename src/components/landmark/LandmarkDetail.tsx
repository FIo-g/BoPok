'use client'

// 랜드마크 상세 화면: 왼쪽 사진, 오른쪽 위 정보 카드(이름·설명·칩·"지도 더 둘러보기"), 오른쪽 아래 위치 미니맵.
// 모바일은 아래에서 올라오는 시트(끌어 내리면 닫힘). 단계(phase)는 useLandmarkDetail 이 정하고, 여기서는 그리기·포커스·키보드만 한다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { LazyLandmarkMiniMap, type Landmark } from '@/components/map'
import { shouldCloseOnKey, shouldCloseSheet, type DetailPhase } from './landmark-detail'
import { ARTS_CENTER_HALLS, hallById } from '@/lib/indoor/arts-center'
import { IndoorInfo } from './indoor/IndoorInfo'
import { IndoorProvider } from './indoor/IndoorProvider'
import { IndoorStage } from './indoor/IndoorStage'
import './landmark-detail.css'

// 실내 보기는 대전예술의전당에만 있다(시연용 개략도)
const INDOOR_LANDMARK_ID = 'arts-center'

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function LandmarkDetail({ landmark, phase, onClose }: { landmark: Landmark; phase: DetailPhase; onClose: () => void }) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [img, setImg] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [drag, setDrag] = useState<number | null>(null) // 모바일 시트를 끌고 있는 거리(px)
  const dragStart = useRef<number | null>(null)
  const hasImage = !!landmark.image && img !== 'error'
  const hasIndoor = landmark.id === INDOOR_LANDMARK_ID
  const [tab, setTab] = useState<string>('outside') // 'outside' 또는 홀 id
  const [switched, setSwitched] = useState(false) // 탭을 한 번이라도 바꿨는지: 처음 열 때는 기존 등장 연출만 쓴다
  const hall = hasIndoor && tab !== 'outside' ? hallById(tab) : undefined
  // 좌표 편집기(?debug=indoor)는 개발 중에만
  const [indoorDebug] = useState(() => process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'indoor')
  const hasLeft = hasImage || hasIndoor
  const changeTab = (next: string) => {
    if (next === tab) return
    setTab(next)
    setSwitched(true)
  }

  // 화면이 막 올라오는 순간 → opening, 올라온 뒤 → open, 내려가는 중 → closing (CSS 가 data-state 하나로 연출한다)
  const state = phase === 'open' ? 'open' : phase === 'closing' ? 'closing' : 'opening'

  // 열리면 X 에 포커스, 닫히면 원래 있던 곳으로 돌려준다
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    // 상세 화면이 떠 있는 동안 가/가+ 글자 크기 토글은 숨긴다(globals.css 의 body[data-landmark-detail])
    document.body.dataset.landmarkDetail = 'open'
    return () => {
      delete document.body.dataset.landmarkDetail
      if (before && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [])

  // 캐시된 이미지는 onLoad 가 마운트 전에 끝났을 수 있어 직접 확인한다
  useEffect(() => {
    const el = imgRef.current
    if (el?.complete) {
      setImg(el.naturalWidth > 0 ? 'loaded' : 'error')
    }
  }, [])

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldCloseOnKey(e.key)) {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 포커스를 이 화면 안에 가둔다(Tab 이 뒤의 지도·버튼으로 나가지 않게)
  const trapFocus = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => el.offsetParent !== null || el === document.activeElement)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  // 모바일: 위쪽 손잡이를 아래로 끌면 시트가 따라 내려가고, 80px 이상이면 닫힌다
  const onDragStart = (e: React.PointerEvent) => {
    dragStart.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(0)
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return
    setDrag(Math.max(0, e.clientY - dragStart.current))
  }
  const onDragEnd = () => {
    const dy = drag ?? 0
    dragStart.current = null
    setDrag(null)
    if (shouldCloseSheet(dy)) onClose()
  }

  const outsideFigure = hasImage ? (
    <figure className="lmd-imageCard lmd-stagger" style={{ '--i': 0, margin: 0 } as React.CSSProperties} data-img={img}>
      <span className="lmd-shimmer" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={landmark.image} alt={landmark.imageAlt} draggable={false} onLoad={() => setImg('loaded')} onError={() => setImg('error')} />
    </figure>
  ) : hasIndoor ? (
    <div className="ind-stageCard lmd-stagger" style={{ '--i': 0 } as React.CSSProperties}>
      <p className="lmd-imageFallback">{landmark.name}</p>
    </div>
  ) : null

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="lmd-panel"
      data-noimage={!hasLeft}
      data-indoor={!!hall}
      data-dragging={drag !== null}
      style={drag !== null ? ({ '--drag': drag } as React.CSSProperties) : undefined}
    >
      <div className="lmd-grabber" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} aria-hidden="true" />
      {hasIndoor ? (
        <div className="ind-left">
          <div className="ind-tabs lmd-stagger" style={{ '--i': 0 } as React.CSSProperties} role="tablist" aria-label="보기 선택">
            <button type="button" role="tab" className="ind-tab" aria-selected={tab === 'outside'} onClick={() => changeTab('outside')}>외관</button>
            {ARTS_CENTER_HALLS.map(h => (
              <button key={h.hallId} type="button" role="tab" className="ind-tab" aria-selected={tab === h.hallId} onClick={() => changeTab(h.hallId)}>{h.name}</button>
            ))}
          </div>
          <div key={tab} className={switched ? 'ind-appear' : undefined} style={{ height: '100%' }}>
            {hall ? (
              <div className="ind-stageCard lmd-stagger" style={{ '--i': 0 } as React.CSSProperties}>
                <IndoorStage />
              </div>
            ) : (
              outsideFigure
            )}
          </div>
        </div>
      ) : (
        outsideFigure
      )}
      <div className="lmd-side">
        <section className="lmd-card lmd-stagger" style={{ '--i': 1 } as React.CSSProperties}>
          <button ref={closeRef} type="button" className="lmd-close" onClick={onClose} aria-label="상세 화면 닫기">
            <span aria-hidden="true">✕</span>
          </button>
          {hall ? (
            <>
              <p className="lmd-area">{landmark.name} · 실내 보기</p>
              <div key={tab} className={switched ? 'ind-appear' : undefined}>
                <IndoorInfo titleId={titleId} />
              </div>
            </>
          ) : (
            <div key={tab} className={switched ? 'ind-appear' : undefined} style={{ display: 'contents' }}>
              <p className="lmd-area">{landmark.area}</p>
              <h2 id={titleId} className="lmd-name">{landmark.name}</h2>
              <p className="lmd-summary">{landmark.summary}</p>
              <ul className="lmd-tags" aria-label="특징">
                {landmark.tags.map(tag => <li key={tag}>{tag}</li>)}
              </ul>
            </div>
          )}
          <button type="button" className="lmd-cta lmd-ctaCard" onClick={onClose}>지도 더 둘러보기</button>
        </section>
        <div className="lmd-mapBox lmd-stagger" style={{ '--i': 2 } as React.CSSProperties} role="img" aria-label={`${landmark.name} 위치 지도`}>
          <LazyLandmarkMiniMap landmark={landmark} />
        </div>
      </div>
      <button type="button" className="lmd-cta lmd-ctaSticky" onClick={onClose}>지도 더 둘러보기</button>
    </div>
  )

  return (
    <div ref={rootRef} className="lmd-root" data-state={state} onKeyDown={trapFocus}>
      <div className="lmd-backdrop" onClick={onClose} aria-hidden="true" />
      {hasIndoor ? <IndoorProvider hall={hall ?? ARTS_CENTER_HALLS[0]} debug={indoorDebug}>{panel}</IndoorProvider> : panel}
    </div>
  )
}
