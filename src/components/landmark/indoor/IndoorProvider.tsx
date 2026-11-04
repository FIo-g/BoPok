'use client'

// 홀 하나의 실내 보기 상태(입체/평면, 층, 도착 객석, 경로 옵션)와 경로 그리기 재생을 한 곳에 둔다.
// 왼쪽 무대(IndoorStage)와 오른쪽 정보 카드(IndoorInfo)가 같은 상태를 보도록 컨텍스트로 나눠 준다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { findRoute, routeChip, type RouteChip, type RouteFound, type RouteMode, type RouteResult } from '@/lib/indoor/route'
import type { IndoorEdge, IndoorHall, IndoorNode } from '@/lib/indoor/types'

export const DRAW_MS = 1200 // 평면 위에서 선이 그려지는 시간
export const PAUSE_MS = 400 // 층이 바뀌는 지점(엘리베이터·계단 아이콘)에서 멈추는 시간

export type RoutePlayback = { active: boolean; legIndex: number; drawKey: number }

type IndoorContextValue = {
  hall: IndoorHall
  view: 'exploded' | 'plan'
  level: number
  dest: number | null
  mode: RouteMode
  result: RouteResult | null
  found: RouteFound | null
  chip: RouteChip | null
  playback: RoutePlayback
  reducedMotion: boolean
  // 지금 평면에 그릴 경로 조각(노드 순서대로). 재생 중이면 그리는 중인 구간 하나, 아니면 이 층의 구간 전부
  paths: IndoorNode[][]
  nodes: IndoorNode[]
  edges: IndoorEdge[]
  debug: boolean
  openPlan: (level: number) => void
  backToExploded: () => void
  selectLevel: (level: number) => void
  selectDest: (level: number | null) => void
  setMode: (mode: RouteMode) => void
  addNode: (node: IndoorNode) => void
  addEdge: (edge: IndoorEdge) => void
}

const IndoorContext = createContext<IndoorContextValue | null>(null)

export function useIndoor(): IndoorContextValue {
  const value = useContext(IndoorContext)
  if (!value) throw new Error('useIndoor must be used inside IndoorProvider')
  return value
}

const reducedMotionNow = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function IndoorProvider({ hall, debug, children }: { hall: IndoorHall; debug: boolean; children: React.ReactNode }) {
  const [view, setView] = useState<'exploded' | 'plan'>('exploded')
  const [level, setLevel] = useState(hall.floors[0]?.level ?? 1)
  const [dest, setDest] = useState<number | null>(null)
  const [mode, setModeState] = useState<RouteMode>('nostairs')
  const [playback, setPlayback] = useState<RoutePlayback>({ active: false, legIndex: 0, drawKey: 0 })
  const [extraNodes, setExtraNodes] = useState<IndoorNode[]>([])
  const [extraEdges, setExtraEdges] = useState<IndoorEdge[]>([])
  const [reducedMotion] = useState(reducedMotionNow)
  const runId = useRef(0) // 재생을 세는 번호: 사용자가 층을 직접 바꾸거나 새로 고르면 이전 재생은 멈춘다
  const drawKey = useRef(0)

  // 홀 탭을 바꾸면 보던 층·경로·편집기에서 찍은 지점을 처음 상태로 돌린다
  const [prevHallId, setPrevHallId] = useState(hall.hallId)
  if (prevHallId !== hall.hallId) {
    setPrevHallId(hall.hallId)
    setView('exploded')
    setLevel(hall.floors[0]?.level ?? 1)
    setDest(null)
    setPlayback({ active: false, legIndex: 0, drawKey: 0 })
    setExtraNodes([])
    setExtraEdges([])
  }

  // 편집기에서 찍은 지점을 합쳐서 경로를 계산해 볼 수 있게 한다
  const nodes = useMemo(() => [...hall.nodes, ...extraNodes], [hall.nodes, extraNodes])
  const edges = useMemo(() => [...hall.edges, ...extraEdges], [hall.edges, extraEdges])
  const merged = useMemo<IndoorHall>(() => ({ ...hall, nodes, edges }), [hall, nodes, edges])

  const result = useMemo(() => (dest === null ? null : findRoute(merged, dest, mode)), [merged, dest, mode])
  const found = result && (result.status === 'ok' ? result.route : result.status === 'needs-stairs' ? result.alternative : null)
  const chip = useMemo(() => (result ? routeChip(result) : null), [result])

  // 경로가 정해지면 입구 층 평면에서 선을 그리고, 층이 바뀌는 지점에서 잠깐 멈춘 뒤 다음 층 평면으로 넘어가 이어서 그린다
  useEffect(() => {
    if (!found) return
    const id = ++runId.current
    const timers: number[] = []
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => { if (runId.current === id) fn() }, ms))
    const last = found.legs.length - 1
    if (reducedMotion) {
      // 움직임 줄이기: 그리는 연출 없이 완성된 선을 보여 준다(첫 구간 층부터)
      later(() => {
        setView('plan')
        setLevel(found.legs[0].level)
        setPlayback({ active: false, legIndex: 0, drawKey: ++drawKey.current })
      }, 0)
    } else {
      const run = (i: number) => {
        setView('plan')
        setLevel(found.legs[i].level)
        setPlayback({ active: true, legIndex: i, drawKey: ++drawKey.current })
        later(() => {
          if (i < last) later(() => run(i + 1), PAUSE_MS)
          else setPlayback(p => ({ ...p, active: false }))
        }, DRAW_MS)
      }
      later(() => run(0), 0)
    }
    return () => timers.forEach(window.clearTimeout)
  }, [found, reducedMotion])

  const stopPlayback = useCallback(() => {
    runId.current++
    setPlayback(p => (p.active ? { ...p, active: false } : p))
  }, [])

  const openPlan = useCallback((l: number) => {
    stopPlayback()
    setLevel(l)
    setView('plan')
  }, [stopPlayback])
  const backToExploded = useCallback(() => {
    stopPlayback()
    setView('exploded')
  }, [stopPlayback])
  const selectLevel = useCallback((l: number) => {
    stopPlayback()
    setLevel(l)
  }, [stopPlayback])
  const selectDest = useCallback((l: number | null) => {
    stopPlayback()
    setDest(prev => (prev === l ? null : l))
  }, [stopPlayback])
  const setMode = useCallback((m: RouteMode) => {
    stopPlayback()
    setModeState(m)
  }, [stopPlayback])

  const paths = useMemo<IndoorNode[][]>(() => {
    if (!found) return []
    const byId = new Map(nodes.map(n => [n.id, n]))
    const toNodes = (ids: string[]) => ids.map(id => byId.get(id)).filter((n): n is IndoorNode => !!n)
    if (playback.active) return [toNodes(found.legs[playback.legIndex]?.nodeIds ?? [])]
    return found.legs.filter(leg => leg.level === level).map(leg => toNodes(leg.nodeIds))
  }, [found, nodes, playback.active, playback.legIndex, level])

  const value: IndoorContextValue = {
    hall, view, level, dest, mode, result, found, chip, playback, reducedMotion, paths, nodes, edges, debug,
    openPlan, backToExploded, selectLevel, selectDest, setMode,
    addNode: node => setExtraNodes(list => [...list, node]),
    addEdge: edge => setExtraEdges(list => [...list, edge]),
  }
  return <IndoorContext.Provider value={value}>{children}</IndoorContext.Provider>
}
