'use client'

// 랜드마크 상세 화면: 왼쪽 사진, 오른쪽 위 정보 카드(이름·설명·칩·"이 장소로 일정 만들기"), 오른쪽 아래 위치 미니맵.
// 모바일은 아래에서 올라오는 시트(끌어 내리면 닫힘). 단계(phase)는 useLandmarkDetail 이 정하고, 여기서는 그리기·포커스·키보드만 한다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { LazyLandmarkMiniMap, type Landmark } from '@/components/map'
import { shouldCloseOnKey, shouldCloseSheet, type DetailPhase } from './landmark-detail'
import './landmark-detail.css'

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function LandmarkDetail({ landmark, phase, onClose, onStartPlan }: { landmark: Landmark; phase: DetailPhase; onClose: () => void; onStartPlan: (landmark: Landmark) => void }) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [img, setImg] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [drag, setDrag] = useState<number | null>(null) // 모바일 시트를 끌고 있는 거리(px)
  const dragStart = useRef<number | null>(null)
  const hasImage = !!landmark.image && img !== 'error'

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

  return (
    <div ref={rootRef} className="lmd-root" data-state={state} onKeyDown={trapFocus}>
      <div className="lmd-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="lmd-panel"
        data-noimage={!hasImage}
        data-dragging={drag !== null}
        style={drag !== null ? ({ '--drag': drag } as React.CSSProperties) : undefined}
      >
        <div className="lmd-grabber" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} aria-hidden="true" />
        {hasImage && (
          <figure className="lmd-imageCard lmd-stagger" style={{ '--i': 0, margin: 0 } as React.CSSProperties} data-img={img}>
            <span className="lmd-shimmer" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={landmark.image} alt={landmark.imageAlt} draggable={false} onLoad={() => setImg('loaded')} onError={() => setImg('error')} />
          </figure>
        )}
        <div className="lmd-side">
          <section className="lmd-card lmd-stagger" style={{ '--i': 1 } as React.CSSProperties}>
            <button ref={closeRef} type="button" className="lmd-close" onClick={onClose} aria-label="상세 화면 닫기">
              <span aria-hidden="true">✕</span>
            </button>
            <p className="lmd-area">{landmark.area}</p>
            <h2 id={titleId} className="lmd-name">{landmark.name}</h2>
            <p className="lmd-summary">{landmark.summary}</p>
            <ul className="lmd-tags" aria-label="특징">
              {landmark.tags.map(tag => <li key={tag}>{tag}</li>)}
            </ul>
            <button type="button" className="lmd-cta lmd-ctaCard" onClick={() => onStartPlan(landmark)}>이 장소로 일정 만들기</button>
          </section>
          <div className="lmd-mapBox lmd-stagger" style={{ '--i': 2 } as React.CSSProperties} role="img" aria-label={`${landmark.name} 위치 지도`}>
            <LazyLandmarkMiniMap landmark={landmark} />
          </div>
        </div>
        <button type="button" className="lmd-cta lmd-ctaSticky" onClick={() => onStartPlan(landmark)}>이 장소로 일정 만들기</button>
      </div>
    </div>
  )
}
