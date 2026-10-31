'use client'

// 일정(stops)이 바뀔 때마다 판정을 다시 한다 (docs/roles/frontend.md "즉시 재판정 흐름"):
//  1) 장소 상세를 받는다(없는 것만)  2) engine.requiredLegs 로 필요한 경로를 구해 없는 것만 서버에서 받는다(디바운스 250ms)
//  3) engine.judge 로 결과를 낸다. 판정·걷는 시간·계단 수는 항상 엔진 결과이고 여기서 따로 계산하지 않는다.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { legKey, type Condition, type JudgeResult, type Leg, type PlaceDetail, type Stop, type Traveler } from '@/lib/contracts'
import { judge, requiredLegs } from '@/lib/engine'
import {
  ensureLegs, ensurePlaces, isLegModeSupported, getLegsRecord, getPlacesRecord, getPlanRevision, legFailed, placeFailed, resetFailures, subscribePlan,
} from '@/lib/plan/plan-cache'

const LEG_DEBOUNCE_MS = 250
const EMPTY_PLACES: Record<string, PlaceDetail> = {}
const EMPTY_LEGS: Record<string, Leg> = {}

export type Judged = {
  result: JudgeResult
  places: Record<string, PlaceDetail>
  legs: Record<string, Leg>
  // 필요한 장소·경로를 모두 받았는지(받지 못한 것은 실패로 센다). false 인 동안은 직전 결과를 보여 준다
  settled: boolean
  // 일부 장소·경로를 받지 못해 결과가 부분 판정일 때
  incomplete: boolean
  retry: () => void
}

export function useJudged(stops: Stop[] | undefined, travelers: Traveler[] | undefined, tuned?: Partial<Condition>): Judged | null {
  useSyncExternalStore(subscribePlan, getPlanRevision, () => 0)
  const places = useSyncExternalStore(subscribePlan, getPlacesRecord, () => EMPTY_PLACES)
  const legs = useSyncExternalStore(subscribePlan, getLegsRecord, () => EMPTY_LEGS)

  const placeIds = useMemo(() => [...new Set((stops ?? []).flatMap(stop => (stop.placeId ? [stop.placeId] : [])))], [stops])
  useEffect(() => {
    void ensurePlaces(placeIds)
  }, [placeIds])

  const placesReady = placeIds.every(id => Object.hasOwn(places, id) || placeFailed(id))
  // 경로는 장소를 모두 받은 뒤에야 구할 수 있다(출발·도착 지점을 장소 안 길에서 찾는다)
  const needed = useMemo(() => (stops && placesReady ? requiredLegs(stops, places) : []), [stops, places, placesReady])
  const missing = useMemo(() => needed.filter(req => !Object.hasOwn(legs, legKey(req))), [needed, legs])
  useEffect(() => {
    if (missing.length === 0) return
    const timer = setTimeout(() => void ensureLegs(missing), LEG_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [missing])

  const result = useMemo(
    () => (stops && travelers && travelers.length > 0 ? judge({ travelers, tuned, stops, places, legs }) : null),
    [stops, travelers, tuned, places, legs],
  )
  const settled = placesReady && missing.every(req => legFailed(legKey(req)))
  // 지원하지 않는 이동수단(버스)의 경로는 "받지 못한 것"이 아니라 아직 없는 기능이라 따로 센다
  const incomplete = placeIds.some(id => !Object.hasOwn(places, id)) || missing.some(req => isLegModeSupported(legKey(req)))

  // 받는 중에는 직전에 완성된 결과를 그대로 둔다(숫자가 잠깐 "정보 없음"으로 깜빡이지 않게). 렌더 중 상태 맞추기 패턴
  const [held, setHeld] = useState<JudgeResult | null>(null)
  if (result && settled && held !== result) setHeld(result)

  const retry = useCallback(() => resetFailures(), [])
  const shown = settled ? result : (held ?? result)
  return shown ? { result: shown, places, legs, settled, incomplete, retry } : null
}
