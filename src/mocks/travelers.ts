// 목업 PUT /api/trips/:id/travelers. 서버(src/lib/trips/travelers.ts 의 replaceTravelers)와 같은 규칙으로 저장할 목록을 만든다.
// 화면이 보낸 userId·filledBySelf 를 그대로 믿지 않는다. 믿으면 누구나 남의 계정을 걸거나 "부모님이 직접 답했다"고 꾸밀 수 있어 판정 근거가 거짓이 된다.
import { ApiRequestError } from '@/lib/api-client/http'
import type { Traveler } from '@/lib/contracts'
import { conditionChanged } from '@/lib/plan/travelers'

function reject(message: string): never {
  throw new ApiRequestError(400, 'invalid_request', message)
}

// 저장할 계정 연결을 정한다. 내 연결만 걸고 풀 수 있다
function resolveUserId(incoming: Traveler, existing: Traveler | undefined, actorUserId: string): string | null {
  const existingUserId = existing?.userId ?? null
  const incomingUserId = incoming.userId ?? null
  if (incomingUserId === existingUserId) return existingUserId
  // 남의 연결은 그 본인만 풀거나 바꿀 수 있다. 남이 보내도 기존 값을 지키고, 오류로 막지는 않는다
  if (existingUserId !== null && existingUserId !== actorUserId) return existingUserId
  // 새로 거는 연결은 내 계정만
  if (incomingUserId !== null && incomingUserId !== actorUserId) return reject('내 계정만 연결할 수 있어요')
  return incomingUserId
}

export function replaceMockTravelers(args: { before: Traveler[]; incoming: Traveler[]; actorUserId: string }): Traveler[] {
  const { before, incoming, actorUserId } = args
  const ids = incoming.map(one => one.id)
  if (new Set(ids).size !== ids.length) reject('같은 id의 여행자가 둘 이상이에요')
  const beforeById = new Map(before.map((one): [string, Traveler] => [one.id, one]))

  const saved = incoming.map((one): Traveler => {
    const existing = beforeById.get(one.id)
    const userId = resolveUserId(one, existing, actorUserId)
    // 한 번 true 면 계속 true. 내 계정과 연결된 사람이 새로 생겼거나 걷기 조건이 실제로 바뀌었을 때만 새로 true 가 된다 (연결만 한 것은 아니다)
    const filledBySelf = existing?.filledBySelf === true || (userId === actorUserId && (existing === undefined || conditionChanged(existing, one)))
    const next: Traveler = { ...one, filledBySelf }
    if (userId === null) delete next.userId
    else next.userId = userId
    return next
  })

  const linked = saved.flatMap(one => (one.userId ? [one.userId] : []))
  if (new Set(linked).size !== linked.length) reject('한 계정은 한 사람과만 연결할 수 있어요')
  return saved
}
