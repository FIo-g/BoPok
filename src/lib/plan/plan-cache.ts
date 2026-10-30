'use client'

// 일정 화면이 쓰는 장소 상세와 장소 사이 경로를 한 번만 받아 두는 곳 (일정이 바뀔 때 없는 것만 서버에 묻는다).
// 같은 값을 여러 화면 부품이 쓰므로 모듈 안에 두고, 바뀌면 revision 숫자로 알린다 (useSyncExternalStore).
import { api } from '@/lib/api-client'
import { legKey, type Leg, type LegRequest, type PlaceDetail } from '@/lib/contracts'

const places = new Map<string, PlaceDetail>()
const legs = new Map<string, Leg>()
const failedPlaces = new Set<string>()
const failedLegs = new Set<string>()
const listeners = new Set<() => void>()
let revision = 0
let placesRecord: Record<string, PlaceDetail> = {}
let legsRecord: Record<string, Leg> = {}

function changed() {
  revision += 1
  placesRecord = Object.fromEntries(places)
  legsRecord = Object.fromEntries(legs)
  listeners.forEach(listener => listener())
}

export const subscribePlan = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getPlanRevision = () => revision
export const getPlacesRecord = () => placesRecord
export const getLegsRecord = () => legsRecord

export const hasPlace = (id: string) => places.has(id)
export const hasLeg = (key: string) => legs.has(key)
export const placeFailed = (id: string) => failedPlaces.has(id)
export const legFailed = (key: string) => failedLegs.has(key)

const pendingPlaces = new Set<string>()
const pendingLegs = new Set<string>()

// 없는 장소만 서버에 묻는다. 못 받은 것은 실패로 적어 두고(무한 재시도 방지) resetFailures 뒤에 다시 시도한다
export async function ensurePlaces(ids: string[]): Promise<void> {
  const missing = [...new Set(ids)].filter(id => !places.has(id) && !failedPlaces.has(id) && !pendingPlaces.has(id))
  if (missing.length === 0) return
  missing.forEach(id => pendingPlaces.add(id))
  try {
    const details = await api.places.details(missing)
    for (const detail of details) places.set(detail.id, detail)
    for (const id of missing) if (!places.has(id)) failedPlaces.add(id)
  } catch {
    missing.forEach(id => failedPlaces.add(id))
  } finally {
    missing.forEach(id => pendingPlaces.delete(id))
  }
  changed()
}

export async function ensureLegs(requests: LegRequest[]): Promise<void> {
  const byKey = new Map<string, LegRequest>()
  for (const req of requests) {
    const key = legKey(req)
    if (!legs.has(key) && !failedLegs.has(key) && !pendingLegs.has(key)) byKey.set(key, req)
  }
  if (byKey.size === 0) return
  const keys = [...byKey.keys()]
  keys.forEach(key => pendingLegs.add(key))
  try {
    const received = await api.legs.get(keys.map(key => byKey.get(key)!))
    // 응답은 요청 순서와 같다. 서버가 key 를 주면 그것을, 아니면 순서대로 짝을 짓는다
    received.forEach((leg, i) => legs.set(keys[i] ?? leg.key, { ...leg, key: keys[i] ?? leg.key }))
    for (const key of keys) if (!legs.has(key)) failedLegs.add(key)
  } catch {
    keys.forEach(key => failedLegs.add(key))
  } finally {
    keys.forEach(key => pendingLegs.delete(key))
  }
  changed()
}

// "다시 시도": 실패로 적어 둔 것을 지우고 다시 받게 한다
export function resetFailures(): void {
  failedPlaces.clear()
  failedLegs.clear()
  changed()
}

// 테스트·목업 초기화용
export function clearPlanCache(): void {
  places.clear()
  legs.clear()
  failedPlaces.clear()
  failedLegs.clear()
  pendingPlaces.clear()
  pendingLegs.clear()
  changed()
}
