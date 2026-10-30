import type {
  Condition,
  ConditionFrom,
  ConditionSource,
  PendingConsent,
  Sex,
  Traveler,
} from '@/lib/contracts'
import {
  ADULT_MIN_AGE,
  ADULT_SPEED_TABLE,
  CHILD_SPEED_TABLE,
  DEFAULT_CONDITION,
  HEIGHT_ADJUST_CAP_MPS,
  HEIGHT_MPS_PER_CM,
  HEIGHT_REF_CM,
  MOBILITY_AID_CAP_MPS,
  PARENT_WEIGHT,
  SLOW_CAP_MPS,
  UNKNOWN_AGE_SPEED_MPS,
} from './constants'

// 표는 나이 오름차순이므로 minAge <= age인 마지막 줄이 그 나이대다.
function rowForAge<T extends { minAge: number }>(table: readonly T[], age: number): T {
  let found = table[0]
  for (const row of table) {
    if (row.minAge <= age) found = row
  }
  return found
}

// 성별을 모르면 그 나이대에서 더 느린 쪽으로 본다. 같으면 여성 (설계 7.1).
function slowerSex(femaleMps: number, maleMps: number): Sex {
  return maleMps < femaleMps ? 'male' : 'female'
}

function clamp(value: number, cap: number): number {
  return Math.min(cap, Math.max(-cap, value))
}

// 여행자 한 명의 걷는 속도 (m/s). 반올림하지 않는다.
export function travelerSpeedMps(traveler: Traveler): number {
  const { age, heightCm, mobilityAid, pace } = traveler
  let speedMps: number

  if (age === undefined) {
    // 나이를 모르면 '천천히'와 같게 잡고 키 보정은 하지 않는다 (설계 7.1).
    speedMps = UNKNOWN_AGE_SPEED_MPS
  } else if (age < ADULT_MIN_AGE) {
    // 아동은 성별·키 보정 없이 표 값만 쓴다.
    speedMps = rowForAge(CHILD_SPEED_TABLE, age).speedMps
  } else {
    const row = rowForAge(ADULT_SPEED_TABLE, age)
    const sex = traveler.sex ?? slowerSex(row.femaleMps, row.maleMps)
    const baseMps = sex === 'female' ? row.femaleMps : row.maleMps
    const heightAdjustMps =
      heightCm === undefined
        ? 0
        : clamp((heightCm - HEIGHT_REF_CM[sex]) * HEIGHT_MPS_PER_CM, HEIGHT_ADJUST_CAP_MPS)
    speedMps = baseMps + heightAdjustMps
  }

  // 본인 답(천천히·보조기구)이 나이 기준 값보다 빠르지 않게 한다. 속도 '모름'은 상한 없음.
  if (pace === 'slow') speedMps = Math.min(speedMps, SLOW_CAP_MPS)
  if (mobilityAid) speedMps = Math.min(speedMps, MOBILITY_AID_CAP_MPS)
  return speedMps
}

// 일행이 실제로 쓰는 속도와 걷기 조건. 판정 결과에 그대로 담긴다 (설계 7.1.1).
export type GroupProfile = {
  speedMps: number
  speedTravelerId: string
  condition: Condition
  conditionFrom: ConditionFrom
  pendingConsents: PendingConsent[]
}

const NUMERIC_FIELDS = ['continuousMin', 'dayMin', 'restMin'] as const
type NumericField = (typeof NUMERIC_FIELDS)[number]

// 걷기 칸은 짧을수록, 쉬는 시간은 길수록 엄격하다 (설계 7.1.1).
function isStricter(field: NumericField, a: number, b: number): boolean {
  return field === 'restMin' ? a > b : a < b
}

type Answer = { travelerId: string; value: number }

// 답한 사람 중 가장 엄격한 값. 같으면 배열에서 먼저 나온 사람을 남긴다.
function strictestOf(field: NumericField, list: Traveler[]): Answer | undefined {
  let found: Answer | undefined
  for (const traveler of list) {
    const value = traveler.condition[field]
    if (typeof value !== 'number') continue
    if (!found || isStricter(field, value, found.value)) found = { travelerId: traveler.id, value }
  }
  return found
}

// 0.8·P + 0.2·O 같은 계산의 부동소수점 오차(25.999…)가 1분을 깎지 않게 한다.
const EPS = 1e-9

// 결과는 늘 안전한 쪽 정수로 (걷기 내림, 쉬는 시간 올림).
function roundField(field: NumericField, value: number): number {
  return field === 'restMin' ? Math.ceil(value - EPS) : Math.floor(value + EPS)
}

type NumericResult = { value: number; from: ConditionSource; pendingConsents: PendingConsent[] }

function numericCondition(field: NumericField, parents: Traveler[], others: Traveler[]): NumericResult {
  const parentAnswer = strictestOf(field, parents)
  const otherAnswer = strictestOf(field, others)
  const fallback = DEFAULT_CONDITION[field]
  const pendingConsents: PendingConsent[] = []

  if (parents.length === 0) {
    if (otherAnswer) return { value: roundField(field, otherAnswer.value), from: 'other', pendingConsents }
    return { value: fallback, from: 'default', pendingConsents }
  }

  // 답한 부모님이 없으면 기본값을 부모님 값으로 본다 — 자녀 답만으로 부모님 한계를 정하지 않는다.
  const parentDefault = parentAnswer === undefined
  const parentValue = parentAnswer ? parentAnswer.value : fallback
  const parentFrom: ConditionSource = parentDefault ? 'default' : 'parent'

  if (!otherAnswer) return { value: roundField(field, parentValue), from: parentFrom, pendingConsents }

  // 부모님 80% + 다른 사람 20%. 섞은 값이 부모님보다 엄격할 때만 쓴다.
  const blend = PARENT_WEIGHT * parentValue + (1 - PARENT_WEIGHT) * otherAnswer.value
  const useBlend = isStricter(field, blend, parentValue)
  const value = useBlend ? blend : parentValue
  const from: ConditionSource = useBlend ? 'blend' : parentFrom

  // 기본값을 쓴 부모님께는 다른 사람 답이 기본값보다 느슨할 때만 확인을 받는다 (설계 7.1.3).
  if (parentDefault && isStricter(field, fallback, otherAnswer.value)) {
    for (const parent of parents) {
      pendingConsents.push({
        field,
        parentTravelerId: parent.id,
        proposedValue: otherAnswer.value,
        fromTravelerId: otherAnswer.travelerId,
        askCreator: !parent.userId,
      })
    }
  }

  return { value: roundField(field, value), from, pendingConsents }
}

function stairsCondition(
  parents: Traveler[],
  others: Traveler[],
): { value: boolean; from: ConditionSource; pendingConsents: PendingConsent[] } {
  const fallback = DEFAULT_CONDITION.avoidStairs
  const pendingConsents: PendingConsent[] = []
  const answeredParents = parents.filter(parent => typeof parent.condition.avoidStairs === 'boolean')
  const answeredOthers = others.filter(other => typeof other.condition.avoidStairs === 'boolean')

  if (parents.length > 0) {
    // 부모님 답이 있으면 한 분이라도 피하면 피한다.
    if (answeredParents.length > 0) {
      return {
        value: answeredParents.some(parent => parent.condition.avoidStairs === true),
        from: 'parent',
        pendingConsents,
      }
    }
    // 부모님은 모르지만 다른 사람이 피하자면 그대로 피한다.
    if (answeredOthers.some(other => other.condition.avoidStairs === true)) {
      return { value: true, from: 'other', pendingConsents }
    }
    // 모두 괜찮다고 했어도 기본값(피하기)을 유지하고 부모님께 확인한다.
    const firstOther = answeredOthers[0]
    if (firstOther) {
      for (const parent of parents) {
        pendingConsents.push({
          field: 'avoidStairs',
          parentTravelerId: parent.id,
          proposedValue: false,
          fromTravelerId: firstOther.id,
          askCreator: !parent.userId,
        })
      }
    }
    return { value: fallback, from: 'default', pendingConsents }
  }

  if (answeredOthers.length > 0) {
    return {
      value: answeredOthers.some(other => other.condition.avoidStairs === true),
      from: 'other',
      pendingConsents,
    }
  }
  return { value: fallback, from: 'default', pendingConsents }
}

export function groupProfile(travelers: Traveler[], tuned?: Partial<Condition>): GroupProfile {
  if (travelers.length === 0) throw new Error('여행자가 한 명 이상 있어야 해요')

  // 속도에는 부모님 비중을 쓰지 않고 가장 느린 사람을 따른다 (설계 7.1 4번). 같으면 먼저 나온 사람.
  let speedTraveler = travelers[0]
  let speedMps = travelerSpeedMps(speedTraveler)
  for (const traveler of travelers.slice(1)) {
    const mps = travelerSpeedMps(traveler)
    if (mps < speedMps) {
      speedMps = mps
      speedTraveler = traveler
    }
  }

  const parents = travelers.filter(traveler => traveler.isParent)
  const others = travelers.filter(traveler => !traveler.isParent)

  const condition: Condition = { ...DEFAULT_CONDITION }
  const conditionFrom: ConditionFrom = {
    continuousMin: 'default',
    dayMin: 'default',
    restMin: 'default',
    avoidStairs: 'default',
  }
  const pendingConsents: PendingConsent[] = []

  // 확인 목록 순서를 칸 순서 → 부모님 순서로 고정한다.
  for (const field of NUMERIC_FIELDS) {
    const result = numericCondition(field, parents, others)
    condition[field] = result.value
    conditionFrom[field] = result.from
    pendingConsents.push(...result.pendingConsents)
  }

  const stairs = stairsCondition(parents, others)
  condition.avoidStairs = stairs.value
  conditionFrom.avoidStairs = stairs.from
  pendingConsents.push(...stairs.pendingConsents)

  // '조건 바꿔 보기'는 고른 칸만 덮어쓰고, 사용자가 고른 값이라 반올림하지 않는다.
  if (tuned?.continuousMin !== undefined) {
    condition.continuousMin = tuned.continuousMin
    conditionFrom.continuousMin = 'tuned'
  }
  if (tuned?.dayMin !== undefined) {
    condition.dayMin = tuned.dayMin
    conditionFrom.dayMin = 'tuned'
  }
  if (tuned?.restMin !== undefined) {
    condition.restMin = tuned.restMin
    conditionFrom.restMin = 'tuned'
  }
  if (tuned?.avoidStairs !== undefined) {
    condition.avoidStairs = tuned.avoidStairs
    conditionFrom.avoidStairs = 'tuned'
  }

  return {
    speedMps,
    speedTravelerId: speedTraveler.id,
    condition,
    conditionFrom,
    pendingConsents,
  }
}
