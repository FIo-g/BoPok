import { describe, expect, it } from 'vitest'
import type { Condition, Traveler } from '@/lib/contracts'
import { groupProfile, travelerSpeedMps } from './speed'

// 칸만 덮어써서 각 규칙을 따로 확인한다.
const base: Traveler = {
  id: 't',
  label: '엄마',
  pace: 'normal',
  mobilityAid: false,
  isParent: true,
  condition: {},
  filledBySelf: true,
}

const speed = (over: Partial<Traveler>) => travelerSpeedMps({ ...base, ...over })

describe('travelerSpeedMps', () => {
  it('69세 여성 1.21, 70세 여성 1.13', () => {
    expect(speed({ age: 69, sex: 'female' })).toBeCloseTo(1.21, 5)
    expect(speed({ age: 70, sex: 'female' })).toBeCloseTo(1.13, 5)
  })

  it('79세 남성 1.20, 80세 남성 1.05', () => {
    expect(speed({ age: 79, sex: 'male' })).toBeCloseTo(1.2, 5)
    expect(speed({ age: 80, sex: 'male' })).toBeCloseTo(1.05, 5)
  })

  it('29세 남성 1.36, 30세 남성 1.39', () => {
    expect(speed({ age: 29, sex: 'male' })).toBeCloseTo(1.36, 5)
    expect(speed({ age: 30, sex: 'male' })).toBeCloseTo(1.39, 5)
  })

  it('120세 여성은 80세 이상 줄', () => {
    expect(speed({ age: 120, sex: 'female' })).toBeCloseTo(0.97, 5)
  })

  it('키 10 cm 크면 0.07 빠름', () => {
    expect(speed({ age: 70, sex: 'male', heightCm: 181 })).toBeCloseTo(1.27, 5)
  })

  it('키 보정은 +0.10에서 멈춤', () => {
    expect(speed({ age: 60, sex: 'male', heightCm: 200 })).toBeCloseTo(1.36, 5)
  })

  it('키 보정은 −0.10에서 멈춤', () => {
    expect(speed({ age: 60, sex: 'female', heightCm: 130 })).toBeCloseTo(1.11, 5)
  })

  it('성별 모르면 더 느린 쪽 (20대는 남성)', () => {
    expect(speed({ age: 25, heightCm: 171 })).toBeCloseTo(1.36, 5)
    expect(speed({ age: 25, heightCm: 181 })).toBeCloseTo(1.43, 5)
  })

  it('성별 모르면 더 느린 쪽 (70대는 여성)', () => {
    expect(speed({ age: 75, heightCm: 158 })).toBeCloseTo(1.13, 5)
  })

  it('나이 모르면 0.85, 키 무시', () => {
    expect(speed({ heightCm: 180, sex: 'male' })).toBeCloseTo(0.85, 5)
  })

  it('천천히면 0.85 이하', () => {
    expect(speed({ age: 72, sex: 'female', pace: 'slow' })).toBeCloseTo(0.85, 5)
    expect(speed({ age: 85, sex: 'female', pace: 'slow' })).toBeCloseTo(0.85, 5)
  })

  it('천천히라도 원래 느리면 그대로', () => {
    // 0.97 − 0.10 = 0.87이지만 천천히 상한 0.85가 더 낮다.
    expect(speed({ age: 90, sex: 'female', heightCm: 140, pace: 'slow' })).toBeCloseTo(0.85, 5)
  })

  it('보조기구면 0.73 이하, 천천히와 함께여도 0.73', () => {
    expect(speed({ age: 72, sex: 'female', mobilityAid: true })).toBeCloseTo(0.73, 5)
    expect(speed({ age: 72, sex: 'female', mobilityAid: true, pace: 'slow' })).toBeCloseTo(0.73, 5)
  })

  it('나이 모르고 보조기구면 0.73', () => {
    expect(speed({ mobilityAid: true })).toBeCloseTo(0.73, 5)
  })

  it('걷는 속도 모름은 상한 없음', () => {
    expect(speed({ age: 72, sex: 'female', pace: 'unknown' })).toBeCloseTo(1.13, 5)
  })

  it('speed boundaries: 아동 표 경계', () => {
    expect(speed({ age: 0 })).toBeCloseTo(0.89, 5)
    expect(speed({ age: 4 })).toBeCloseTo(0.89, 5)
    expect(speed({ age: 5 })).toBeCloseTo(1.11, 5)
    expect(speed({ age: 6 })).toBeCloseTo(1.11, 5)
    expect(speed({ age: 7 })).toBeCloseTo(1.19, 5)
    expect(speed({ age: 13 })).toBeCloseTo(1.34, 5)
    expect(speed({ age: 14 })).toBeCloseTo(1.28, 5)
    expect(speed({ age: 17 })).toBeCloseTo(1.28, 5)
  })

  it('아동은 성별·키 보정 없음', () => {
    expect(speed({ age: 8, sex: 'male', heightCm: 200 })).toBeCloseTo(1.19, 5)
  })

  it('18세부터 성인 표', () => {
    expect(speed({ age: 18, sex: 'female' })).toBeCloseTo(1.38, 5)
  })

  it('아동도 천천히 상한', () => {
    expect(speed({ age: 10, pace: 'slow' })).toBeCloseTo(0.85, 5)
  })
})

// 여행자 한 명. 계정이 연결된 부모님만 userId를 둔다 (할머니는 계정 없음).
const t = (id: string, isParent: boolean, condition: Partial<Condition>, extra: Partial<Traveler> = {}): Traveler => ({
  ...base,
  id,
  label: id,
  isParent,
  condition,
  userId: id === 'mom' ? 'u-mom' : id === 'dad' ? 'u-dad' : undefined,
  ...extra,
})

describe('groupProfile', () => {
  it('설계 예 1: 엄마 30, 자녀 10 → 26 섞음', () => {
    const profile = groupProfile([t('mom', true, { continuousMin: 30 }), t('kid', false, { continuousMin: 10 })])
    expect(profile.condition.continuousMin).toBe(26)
    expect(profile.conditionFrom.continuousMin).toBe('blend')
  })

  it('설계 예 2: 엄마 20, 자녀 90 → 20 부모님', () => {
    const profile = groupProfile([t('mom', true, { continuousMin: 20 }), t('kid', false, { continuousMin: 90 })])
    expect(profile.condition.continuousMin).toBe(20)
    expect(profile.conditionFrom.continuousMin).toBe('parent')
    expect(profile.pendingConsents).toEqual([])
  })

  it('설계 예 3: 엄마 모름, 아빠 25, 자녀 15 → 23', () => {
    const profile = groupProfile([
      t('mom', true, {}),
      t('dad', true, { continuousMin: 25 }),
      t('kid', false, { continuousMin: 15 }),
    ])
    expect(profile.condition.continuousMin).toBe(23)
    expect(profile.conditionFrom.continuousMin).toBe('blend')
  })

  it('설계 예 4: 엄마 모름, 자녀 90 → 20 기본값 + 엄마께 확인', () => {
    const profile = groupProfile([t('mom', true, {}), t('kid', false, { continuousMin: 90 })])
    expect(profile.condition.continuousMin).toBe(20)
    expect(profile.conditionFrom.continuousMin).toBe('default')
    expect(profile.pendingConsents).toEqual([
      {
        field: 'continuousMin',
        parentTravelerId: 'mom',
        proposedValue: 90,
        fromTravelerId: 'kid',
        askCreator: false,
      },
    ])
  })

  it('계정 없는 할머니는 여행 만든 사람에게 대신 묻기', () => {
    const profile = groupProfile([t('grandma', true, {}), t('kid', false, { continuousMin: 90 })])
    expect(profile.pendingConsents).toHaveLength(1)
    expect(profile.pendingConsents[0].parentTravelerId).toBe('grandma')
    expect(profile.pendingConsents[0].askCreator).toBe(true)
  })

  it('자녀가 더 엄격하면 묻지 않고 섞음', () => {
    const profile = groupProfile([t('mom', true, {}), t('kid', false, { continuousMin: 10 })])
    expect(profile.condition.continuousMin).toBe(18)
    expect(profile.conditionFrom.continuousMin).toBe('blend')
    expect(profile.pendingConsents).toEqual([])
  })

  it('부모님만 가는 여행', () => {
    const profile = groupProfile([t('mom', true, { continuousMin: 30 }), t('dad', true, { continuousMin: 25 })])
    expect(profile.condition.continuousMin).toBe(25)
    expect(profile.conditionFrom.continuousMin).toBe('parent')
    expect(profile.condition.dayMin).toBe(60)
    expect(profile.conditionFrom.dayMin).toBe('default')
  })

  it('부모님 없는 여행', () => {
    const answered = groupProfile([t('kid', false, { continuousMin: 40 }), t('friend', false, { continuousMin: 30 })])
    expect(answered.condition.continuousMin).toBe(30)
    expect(answered.conditionFrom.continuousMin).toBe('other')

    const blank = groupProfile([t('kid', false, {})])
    expect(blank.condition.continuousMin).toBe(20)
    expect(blank.conditionFrom.continuousMin).toBe('default')
  })

  it('하루 총: 엄마 60, 자녀 30 → 54', () => {
    const profile = groupProfile([t('mom', true, { dayMin: 60 }), t('kid', false, { dayMin: 30 })])
    expect(profile.condition.dayMin).toBe(54)
    expect(profile.conditionFrom.dayMin).toBe('blend')
  })

  it('쉬는 시간은 길수록 엄격', () => {
    const blend = groupProfile([t('mom', true, { restMin: 10 }), t('kid', false, { restMin: 20 })])
    expect(blend.condition.restMin).toBe(12)
    expect(blend.conditionFrom.restMin).toBe('blend')

    const parent = groupProfile([t('mom', true, { restMin: 20 }), t('kid', false, { restMin: 5 })])
    expect(parent.condition.restMin).toBe(20)
    expect(parent.conditionFrom.restMin).toBe('parent')
  })

  it('반올림: 걷기 내림, 쉬는 시간 올림', () => {
    const profile = groupProfile([
      t('mom', true, { continuousMin: 25, restMin: 5 }),
      t('kid', false, { continuousMin: 12, restMin: 12 }),
    ])
    expect(profile.condition.continuousMin).toBe(22)
    expect(profile.condition.restMin).toBe(7)
  })

  it('소수 답도 내림', () => {
    const profile = groupProfile([t('mom', true, { continuousMin: 22.5 })])
    expect(profile.condition.continuousMin).toBe(22)
    expect(profile.conditionFrom.continuousMin).toBe('parent')
  })

  // 비중을 0.7 등으로 바꾸면 섞은 값이 3.0000000000000004처럼 나온다. 이런 오차로 1분이 틀어지면 안 된다.
  it('계산 오차는 반올림을 바꾸지 않는다', () => {
    const profile = groupProfile([t('mom', true, { continuousMin: 25.999999999999996, restMin: 3.0000000000000004 })])
    expect(profile.condition.continuousMin).toBe(26)
    expect(profile.condition.restMin).toBe(3)
  })

  it('여러 부모님 확인은 칸 순서, 부모님 순서', () => {
    const profile = groupProfile([
      t('mom', true, {}),
      t('dad', true, {}),
      t('kid', false, { continuousMin: 90, dayMin: 120 }),
    ])
    expect(profile.pendingConsents).toHaveLength(4)
    expect(profile.pendingConsents.map(c => [c.field, c.parentTravelerId])).toEqual([
      ['continuousMin', 'mom'],
      ['continuousMin', 'dad'],
      ['dayMin', 'mom'],
      ['dayMin', 'dad'],
    ])
  })

  it('계단: 부모님 답이 이김', () => {
    const profile = groupProfile([t('mom', true, { avoidStairs: false }), t('kid', false, { avoidStairs: true })])
    expect(profile.condition.avoidStairs).toBe(false)
    expect(profile.conditionFrom.avoidStairs).toBe('parent')
  })

  it('계단: 부모님 모름, 자녀 괜찮아요 → 피하기 + 확인', () => {
    const profile = groupProfile([t('mom', true, {}), t('kid', false, { avoidStairs: false })])
    expect(profile.condition.avoidStairs).toBe(true)
    expect(profile.conditionFrom.avoidStairs).toBe('default')
    expect(profile.pendingConsents).toHaveLength(1)
    expect(profile.pendingConsents[0]).toMatchObject({
      field: 'avoidStairs',
      proposedValue: false,
      fromTravelerId: 'kid',
    })
  })

  it('계단: 부모님 모름, 자녀 피하기 → 피하기', () => {
    const profile = groupProfile([t('mom', true, {}), t('kid', false, { avoidStairs: true })])
    expect(profile.condition.avoidStairs).toBe(true)
    expect(profile.conditionFrom.avoidStairs).toBe('other')
    expect(profile.pendingConsents).toEqual([])
  })

  it('계단: 부모님 없는 여행', () => {
    const profile = groupProfile([t('kid', false, { avoidStairs: false }), t('friend', false, { avoidStairs: false })])
    expect(profile.condition.avoidStairs).toBe(false)
    expect(profile.conditionFrom.avoidStairs).toBe('other')
  })

  it('조건 바꿔 보기는 덮어쓰고 반올림 안 함', () => {
    const profile = groupProfile([t('mom', true, { continuousMin: 20 })], { continuousMin: 32.5 })
    expect(profile.condition.continuousMin).toBe(32.5)
    expect(profile.conditionFrom.continuousMin).toBe('tuned')
  })

  it('속도는 가장 느린 사람, 비중 없음', () => {
    const profile = groupProfile([
      t('mom', true, {}, { age: 72, pace: 'slow' }),
      t('kid', false, {}, { age: 30, pace: 'normal' }),
    ])
    expect(profile.speedMps).toBeCloseTo(0.85, 5)
    expect(profile.speedTravelerId).toBe('mom')
  })

  it('속도 같으면 먼저 나온 사람', () => {
    const profile = groupProfile([
      t('mom', true, {}, { age: 72, pace: 'slow' }),
      t('dad', true, {}, { age: 75, pace: 'slow' }),
    ])
    expect(profile.speedTravelerId).toBe('mom')
  })

  it('여행자가 없으면 오류', () => {
    expect(() => groupProfile([])).toThrow('여행자가 한 명 이상 있어야 해요')
  })
})
