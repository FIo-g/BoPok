'use client'

// 랜드마크 상세 화면의 흐름: 모형 클릭 → 카메라가 건물로 다가감(flyTo) → 150ms 뒤 화면이 올라옴 → 닫으면 내려가며 흐려지고 카메라가 처음 위치로 돌아옴.
// 단계 전환 규칙은 lib/landmark-detail.ts(순수 함수), 여기서는 지도 카메라·타이머·URL(?place=<id>)을 묶는다.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { LANDMARKS, landmarkById, landmarkCenter, landmarkViewBearing, type Landmark, type MapInstance } from '@/components/map'
import { CLOSED, detailReducer, placeIdFromSearch, searchWithPlace, type DetailState } from './landmark-detail'

const FLY_MS = 1200
const ARRIVE_DELAY_MS = 150 // 카메라가 도착한 뒤 화면이 올라오기까지
const CLOSE_MS = 400 // 내려가며 흐려지는 시간
const RETURN_MS = 1000 // 카메라가 처음 위치로 돌아오는 시간
const REDUCED_CLOSE_MS = 200
const DETAIL_PITCH = 62
const KNOWN_IDS = LANDMARKS.map(l => l.id)

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Camera = { center: [number, number]; zoom: number; pitch: number; bearing: number }
const captureCamera = (map: MapInstance): Camera => {
  const c = map.getCenter()
  return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
}

export function useLandmarkDetail({ map, onOpen, onClosed }: { map: MapInstance | null; onOpen?: () => void; onClosed?: () => void }) {
  const [state, dispatch] = useReducer(detailReducer, CLOSED)
  // 닫힌 뒤 카메라가 처음 위치로 돌아오는 중. 이동이 끝나기 전에 자동 이동이 다시 시작하면 서로 끊어서 카메라가 돌아오지 못한다
  const [returning, setReturning] = useState(false)
  const mapRef = useRef(map)
  const stateRef = useRef<DetailState>(CLOSED)
  const callbacks = useRef({ onOpen, onClosed })
  const savedCamera = useRef<Camera | null>(null) // 클릭 전 카메라(닫으면 여기로 돌아간다)
  const pushed = useRef(false) // 우리가 브라우저 기록(뒤로가기 항목)을 하나 쌓았는지
  const instant = useRef(false) // 주소(?place=)로 바로 열 때는 날아가지 않고 도착한 상태로 시작한다
  const initialUrlHandled = useRef(false)
  const reopenRef = useRef<((target: Landmark) => void) | null>(null)

  useEffect(() => {
    mapRef.current = map
    stateRef.current = state
    callbacks.current = { onOpen, onClosed }
  })

  const landmark = landmarkById(state.id)

  // 1) 다가가는 중: 카메라를 건물 앞으로 옮기고, 도착하면 arrived
  useEffect(() => {
    if (state.phase !== 'flying' || !landmark) return
    const m = mapRef.current
    let done = false
    let timer: number | undefined
    let fallback: number | undefined
    const arrive = () => {
      if (done) return
      done = true
      window.clearTimeout(fallback)
      timer = window.setTimeout(() => dispatch({ type: 'arrived' }), instant.current || reduced() ? 0 : ARRIVE_DELAY_MS)
    }
    if (!m) {
      arrive()
    } else {
      savedCamera.current ??= captureCamera(m)
      const target = { center: landmarkCenter(landmark), zoom: landmark.detailZoom, pitch: DETAIL_PITCH, bearing: landmarkViewBearing(landmark) }
      // easeTo·jumpTo 가 진행 중인 이동을 알아서 멈춘다(map.stop() 을 따로 부르면 라이브러리 안에서 이동 처리가 겹쳐 오류가 난다)
      if (instant.current || reduced()) {
        m.jumpTo(target)
        arrive()
      } else {
        m.easeTo({ ...target, duration: FLY_MS, easing: easeInOutCubic })
        // 이전 이동을 끊을 때 나는 moveend 를 도착으로 오인하지 않도록 easeTo 뒤에 단다
        m.once('moveend', arrive)
        fallback = window.setTimeout(arrive, FLY_MS + 500)
      }
    }
    return () => {
      done = true
      window.clearTimeout(timer)
      window.clearTimeout(fallback)
      m?.off('moveend', arrive)
    }
  }, [state.phase, landmark])

  // 2) 막 올라옴: 처음 모습을 한 번 그린 뒤 등장 전환을 시작한다(그려지지 않은 채로 전환하면 연출이 건너뛰어진다)
  useEffect(() => {
    if (state.phase !== 'opening') return
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => dispatch({ type: 'shown' }))
    })
    return () => {
      cancelAnimationFrame(id1)
      cancelAnimationFrame(id2)
    }
  }, [state.phase])

  // 3) 내려가는 중: 연출이 끝나면 닫고, 카메라를 처음 위치로 되돌리고, 자동 이동을 다시 켠다
  useEffect(() => {
    if (state.phase !== 'closing') return
    const timer = window.setTimeout(() => {
      dispatch({ type: 'closed' })
      const m = mapRef.current
      const camera = savedCamera.current
      savedCamera.current = null
      const finish = () => {
        callbacks.current.onClosed?.()
        // 닫는 동안 주소가 다시 ?place= 로 바뀌었다(앞으로가기). 돌아온 뒤 그 장소를 연다
        const again = landmarkById(placeIdFromSearch(window.location.search, KNOWN_IDS))
        if (again) reopenRef.current?.(again)
      }
      if (!m || !camera) {
        finish()
      } else if (reduced()) {
        m.jumpTo(camera)
        finish()
      } else {
        // 돌아오는 이동이 끝날 때(moveend)까지 returning 이 켜져 있다. 이동 중 다른 이동이 끼어들어도 moveend 가 나므로 풀린다
        setReturning(true)
        let over = false
        const end = () => {
          if (over) return
          over = true
          window.clearTimeout(fallback)
          m.off('moveend', end)
          setReturning(false)
          finish()
        }
        const fallback = window.setTimeout(end, RETURN_MS + 500)
        m.easeTo({ ...camera, duration: RETURN_MS, easing: easeInOutCubic })
        m.once('moveend', end)
      }
    }, reduced() ? REDUCED_CLOSE_MS : CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [state.phase])

  const openLandmark = useCallback((target: Landmark, fromUrl = false) => {
    if (stateRef.current.phase !== 'closed') return
    callbacks.current.onOpen?.()
    if (fromUrl) {
      instant.current = true
    } else {
      instant.current = false
      // 새로고침해도 열리고 뒤로가기로 닫히도록 주소에 place 를 쌓는다
      window.history.pushState({ place: target.id }, '', `${window.location.pathname}${searchWithPlace(window.location.search, target.id)}${window.location.hash}`)
      pushed.current = true
    }
    dispatch({ type: 'select', id: target.id })
  }, [])

  const open = useCallback((target: Landmark) => openLandmark(target), [openLandmark])
  useEffect(() => {
    reopenRef.current = target => openLandmark(target, true)
  }, [openLandmark])

  const close = useCallback(() => {
    const phase = stateRef.current.phase
    if (phase === 'closed' || phase === 'closing') return
    dispatch({ type: 'close' })
    if (pushed.current) {
      // 우리가 쌓은 기록이면 뒤로 가서 주소를 되돌린다(popstate 는 이미 closing 이라 무시된다)
      pushed.current = false
      window.history.back()
    } else {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${searchWithPlace(window.location.search, null)}${window.location.hash}`)
    }
  }, [])

  // 브라우저 뒤로가기·앞으로가기: 주소의 place 에 맞춰 열고 닫는다
  useEffect(() => {
    const onPop = () => {
      const id = placeIdFromSearch(window.location.search, KNOWN_IDS)
      const phase = stateRef.current.phase
      if (!id && phase !== 'closed' && phase !== 'closing') {
        pushed.current = false
        dispatch({ type: 'close' })
      } else if (id && phase === 'closed') {
        const target = landmarkById(id)
        if (target) openLandmark(target, true)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [openLandmark])

  // 주소에 ?place=<id> 가 있으면 열린 채로 시작한다(지도가 준비되면, 2.5초 안에 안 되면 지도 없이)
  useEffect(() => {
    if (initialUrlHandled.current) return
    const target = landmarkById(placeIdFromSearch(window.location.search, KNOWN_IDS))
    if (!target) {
      initialUrlHandled.current = true
      return
    }
    const run = () => {
      initialUrlHandled.current = true
      openLandmark(target, true)
    }
    if (map) {
      run()
      return
    }
    const timer = window.setTimeout(run, 2500)
    return () => window.clearTimeout(timer)
  }, [map, openLandmark])

  return { state, landmark, returning, open, close }
}
