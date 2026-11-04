// 목업 건강 정보. 서버(src/lib/health/health.ts + src/app/api/trips/[id]/**/health)와 같은 규칙으로 읽고 쓴다.
// 보이는 범위·고칠 수 있는 사람은 서버와 같은 함수(canSeeHealth·canEditHealth)를 그대로 쓴다 — 목업만 규칙이 달라지면
// 화면이 "본인만" 정보가 새는 것을 목업에서는 알아채지 못한다.
// 병·약 값은 에러 문구에 넣지 않는다 (문구는 서버와 같은 정해진 문장).
import { ApiRequestError } from '@/lib/api-client/http'
import {
  canEditHealth,
  canSeeHealth,
  TravelerHealthInputSchema,
  type Traveler,
  type TravelerHealth,
} from '@/lib/contracts'
import type { MockDb } from './store'

const fail = (status: number, code: 'invalid_request' | 'forbidden' | 'not_found', message: string): never => {
  throw new ApiRequestError(status, code, message)
}

const travelersOf = (db: MockDb, tripId: string): Traveler[] => db.travelers[tripId] ?? []

// 보는 사람이 볼 수 있는 항목만, 여행자 순서대로. 지금 여행자 목록에 없는 사람의 남은 기록은 돌려주지 않는다.
export function listMockHealth(db: MockDb, tripId: string, viewerUserId: string): TravelerHealth[] {
  const found: TravelerHealth[] = []
  for (const traveler of travelersOf(db, tripId)) {
    const health = db.health.find(h => h.tripId === tripId && h.travelerId === traveler.id)
    if (health && canSeeHealth(health, viewerUserId, traveler.userId ?? null)) found.push(health)
  }
  return found
}

// 고치기·지우기 전에 여행자와 지금 저장된 기록을 찾고 권한을 검사한다 (서버의 loadForEdit 와 같다)
function loadForEdit(db: MockDb, tripId: string, travelerId: string, actorUserId: string): TravelerHealth | undefined {
  const traveler = travelersOf(db, tripId).find(t => t.id === travelerId) ?? fail(404, 'not_found', '그 여행자를 찾을 수 없어요')
  const existing = db.health.find(h => h.tripId === tripId && h.travelerId === travelerId)
  if (!canEditHealth(existing ?? null, actorUserId, traveler.userId ?? null)) {
    fail(403, 'forbidden', traveler.userId
      ? '계정이 연결된 분의 건강 정보는 그분만 고칠 수 있어요'
      : '다른 가족이 먼저 넣어 둔 건강 정보라 고칠 수 없어요. 처음 넣은 분께 부탁해 주세요')
  }
  return existing
}

// 저장. 타입은 consent: true 를 요구하지만 화면 쪽 실수까지 서버처럼 막으려고 실행할 때도 스키마로 검사한다.
// 동의 날짜는 지금으로 찍고, 처음 입력한 사람은 바꾸지 않는다.
export function putMockHealth(db: MockDb, args: { tripId: string; travelerId: string; actorUserId: string; body: unknown }): TravelerHealth {
  const parsed = TravelerHealthInputSchema.safeParse(args.body)
  if (!parsed.success) return fail(400, 'invalid_request', '요청 내용이 형식에 맞지 않아요')
  const existing = loadForEdit(db, args.tripId, args.travelerId, args.actorUserId)
  const { conditions, medicationClasses, visibility } = parsed.data
  const saved: TravelerHealth = {
    tripId: args.tripId,
    travelerId: args.travelerId,
    conditions,
    medicationClasses,
    visibility,
    consentAt: new Date().toISOString(),
    enteredByUserId: existing?.enteredByUserId ?? args.actorUserId,
  }
  db.health = [...db.health.filter(h => !(h.tripId === args.tripId && h.travelerId === args.travelerId)), saved]
  return saved
}

// 지우기 = 동의 철회. 기록이 없으면 아무것도 하지 않고 끝난다.
export function deleteMockHealth(db: MockDb, args: { tripId: string; travelerId: string; actorUserId: string }): void {
  const existing = loadForEdit(db, args.tripId, args.travelerId, args.actorUserId)
  if (!existing) return
  db.health = db.health.filter(h => !(h.tripId === args.tripId && h.travelerId === args.travelerId))
}

// 여행자 목록이 바뀌어 빠진 사람의 건강 정보를 지운다 (서버의 deleteHealthExcept 와 같다)
// before: 바꾸기 전 여행자 목록. 계정 연결이 바뀐 사람의 기록도 지운다 (서버 deleteHealthFor 와 같은 까닭 —
// 연결만 걸어 남의 "본인만" 정보를 보지 못하게, 동의는 새 본인이 다시 한다).
export function pruneMockHealth(db: MockDb, tripId: string, before: Traveler[] = []): void {
  const now = travelersOf(db, tripId)
  const linkBefore = new Map(before.map(t => [t.id, t.userId ?? null]))
  const keep = new Set(
    now.filter(t => !linkBefore.has(t.id) || linkBefore.get(t.id) === (t.userId ?? null)).map(t => t.id),
  )
  db.health = db.health.filter(h => h.tripId !== tripId || keep.has(h.travelerId))
}
