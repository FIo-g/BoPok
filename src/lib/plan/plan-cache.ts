'use client'

// 일정 화면이 쓰는 장소 상세와 장소 사이 경로를 한 번만 받아 두는 곳 (일정이 바뀔 때 없는 것만 서버에 묻는다).
// 같은 값을 여러 화면 부품이 쓰므로 모듈 안에 두고, 바뀌면 revision 숫자로 알린다 (useSyncExternalStore).
import { SUPPORTED_LEG_MODES, api } from '@/lib/api-client'
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

const LEG_PARALLEL = 4

// 키 끝의 이동수단 (legKey 는 `...:walk` 처럼 끝난다)
export const legModeOf = (key: string): string => key.slice(key.lastIndexOf(':') + 1)
export const isLegModeSupported = (key: string): boolean => (SUPPORTED_LEG_MODES as readonly string[]).includes(legModeOf(key))

// 경로는 하나씩 따로 요청한다. 서버는 배치에서 일부만 실패하면 실패한 항목만 빼고 200을 주므로(src/lib/geo/README.md)
// 묶어 보내도 받을 수 있는 경로는 받는다. 그래도 하나씩 보내면 어느 요청이 왜 실패했는지(상태 코드)를 바로 알 수 있어 그대로 둔다.
// 지원하지 않는 이동수단은 서버에 보내지 않고 바로 "없음"으로 둔다.
export async function ensureLegs(requests: LegRequest[]): Promise<void> {
  const byKey = new Map<string, LegRequest>()
  for (const req of requests) {
    const key = legKey(req)
    if (!legs.has(key) && !failedLegs.has(key) && !pendingLegs.has(key)) byKey.set(key, req)
  }
  if (byKey.size === 0) return
  const sendable: [string, LegRequest][] = []
  for (const [key, req] of byKey) {
    if (isLegModeSupported(key)) sendable.push([key, req])
    else failedLegs.add(key)
  }
  sendable.forEach(([key]) => pendingLegs.add(key))
  async function fetchOne([key, req]: [string, LegRequest]) {
    try {
      const [leg] = await api.legs.get([req])
      // 서버가 key 를 줘도 우리 키로 저장한다(요청과 같은 legKey 규칙)
      if (leg) legs.set(key, { ...leg, key })
      else failedLegs.add(key)
    } catch {
      failedLegs.add(key)
    } finally {
      pendingLegs.delete(key)
    }
  }
  for (let i = 0; i < sendable.length; i += LEG_PARALLEL) await Promise.all(sendable.slice(i, i + LEG_PARALLEL).map(fetchOne))
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
