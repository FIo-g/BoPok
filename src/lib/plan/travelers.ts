// 함께 가는 사람과 계정 연결 ("이 사람이 저예요"). 여행자(Traveler)는 여행마다 따로 정하고, 계정이 없는 분(할머니 등)도 있어서
// 그룹 구성원을 자동으로 여행자로 넣지 않는다. 대신 로그인한 사람이 자기에 해당하는 여행자를 직접 고르면 userId 가 채워진다.
// 서버는 PUT /api/trips/:id/travelers 에서 userId 가 그룹 구성원일 때만 저장한다 (김경선).
import type { Traveler } from '@/lib/contracts'

// 본인이 직접 채웠다고 볼 수 있는 칸. 이름표·부모님 여부·계정 연결은 "조건을 말한 것"이 아니라서 뺀다
const CONDITION_FIELDS = ['age', 'heightCm', 'sex', 'pace', 'mobilityAid', 'condition'] as const

// 키 순서에 상관없이 같은 값인지 본다. condition 은 서버(jsonb)를 거치면 키 순서가 바뀌어 돌아오는데,
// 순서만 다른 것을 "바뀌었다"로 보면 연결만 해도 본인 입력(filledBySelf)이 올라간다. 서버(src/lib/trips/travelers.ts 의 stable)와 같은 규칙이다.
function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const sameValue = (a: unknown, b: unknown): boolean => stable(a) === stable(b)

// 걷기 조건 칸이 하나라도 달라졌는지. 목업 서버(src/mocks/travelers.ts)도 같은 비교를 쓴다
export const conditionChanged = (before: Traveler, after: Traveler): boolean =>
  CONDITION_FIELDS.some(field => !sameValue(before[field], after[field]))

export const myTraveler = (travelers: Traveler[], myUserId: string): Traveler | undefined => travelers.find(t => t.userId === myUserId)

// 이 여행에서 나는 아직 연결된 사람이 없고, 이 사람은 아직 아무 계정과도 연결되지 않았을 때만 "이 사람이 저예요"를 보여 준다
export const canClaim = (travelers: Traveler[], traveler: Traveler, myUserId: string): boolean =>
  traveler.userId === undefined && myTraveler(travelers, myUserId) === undefined

export function claimTraveler(travelers: Traveler[], travelerId: string, myUserId: string): Traveler[] {
  const target = travelers.find(t => t.id === travelerId)
  if (!target || !canClaim(travelers, target, myUserId)) return travelers
  return travelers.map(t => (t.id === travelerId ? { ...t, userId: myUserId } : t))
}

// 연결 풀기는 내 연결만. 남의 연결은 건드리지 않는다
export const releaseTraveler = (travelers: Traveler[], travelerId: string, myUserId: string): Traveler[] =>
  travelers.map(t => {
    if (t.id !== travelerId || t.userId !== myUserId) return t
    const { userId: _released, ...rest } = t
    void _released
    return rest
  })

// 저장 직전: 내 계정과 연결된 사람의 걷기 조건을 내가 고쳤을 때만 "본인이 직접 입력"(filledBySelf)으로 본다 (설계 7.1.3).
// 연결만 하고 조건은 그대로면 그대로 둔다. 한 번 true 가 된 것은 그대로 유지한다
export function markSelfFilled(original: Traveler[], next: Traveler[], myUserId: string): Traveler[] {
  return next.map(t => {
    if (t.userId !== myUserId || t.filledBySelf) return t
    const before = original.find(o => o.id === t.id)
    const changed = !before || conditionChanged(before, t)
    return changed ? { ...t, filledBySelf: true } : t
  })
}
