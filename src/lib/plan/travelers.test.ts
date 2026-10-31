import { describe, expect, it } from 'vitest'
import type { Traveler } from '@/lib/contracts'
import { canClaim, claimTraveler, conditionChanged, markSelfFilled, myTraveler, releaseTraveler, sameValue } from './travelers'

const t = (id: string, extra: Partial<Traveler> = {}): Traveler => ({
  id, label: id, pace: 'unknown', mobilityAid: false, isParent: false, condition: {}, filledBySelf: false, ...extra,
})

describe('이 사람이 저예요', () => {
  const list = [t('mom'), t('dad', { userId: 'u-dad' }), t('me')]

  it('아직 연결된 사람이 없는 여행자만 고를 수 있고, 이미 계정이 있는 사람은 못 고른다', () => {
    expect(canClaim(list, list[0], 'u-me')).toBe(true)
    expect(canClaim(list, list[1], 'u-me')).toBe(false)
  })

  it('나는 한 여행에서 한 사람과만 연결된다', () => {
    const claimed = claimTraveler(list, 'me', 'u-me')
    expect(myTraveler(claimed, 'u-me')?.id).toBe('me')
    expect(canClaim(claimed, claimed[0], 'u-me')).toBe(false)
    expect(claimTraveler(claimed, 'mom', 'u-me')).toBe(claimed)
  })

  it('남이 연결한 사람은 가로챌 수 없고 남의 연결은 풀 수 없다', () => {
    expect(claimTraveler(list, 'dad', 'u-me')[1].userId).toBe('u-dad')
    expect(releaseTraveler(list, 'dad', 'u-me')[1].userId).toBe('u-dad')
  })

  it('내 연결은 풀 수 있다', () => {
    const claimed = claimTraveler(list, 'me', 'u-me')
    expect('userId' in releaseTraveler(claimed, 'me', 'u-me')[2]).toBe(false)
  })
})

describe('본인이 직접 입력(filledBySelf)', () => {
  const before = [t('mom', { userId: 'u-mom', condition: { continuousMin: 20 } }), t('dad')]

  it('연결만 하고 걷기 조건을 그대로 두면 본인 입력이 아니다', () => {
    const after = claimTraveler(before.map(x => ({ ...x, userId: undefined })), 'mom', 'u-mom')
    expect(markSelfFilled(before.map(x => ({ ...x, userId: undefined })), after, 'u-mom')[0].filledBySelf).toBe(false)
  })

  it('내 계정과 연결된 사람의 조건을 고치면 본인 입력이 된다', () => {
    const after = [{ ...before[0], condition: { continuousMin: 30 } }, before[1]]
    expect(markSelfFilled(before, after, 'u-mom')[0].filledBySelf).toBe(true)
  })

  it('다른 사람(연결 안 된 사람)의 조건을 고쳐도 내 것이 아니니 그 사람은 바뀌지 않는다', () => {
    const after = [before[0], { ...before[1], age: 70 }]
    expect(markSelfFilled(before, after, 'u-mom')[1].filledBySelf).toBe(false)
  })

  it('한 번 본인 입력이 된 것은 유지한다', () => {
    const done = [{ ...before[0], filledBySelf: true }, before[1]]
    expect(markSelfFilled(done, done, 'u-mom')[0].filledBySelf).toBe(true)
  })

  it('걷기 조건의 키 순서만 달라진 것은 바뀐 것으로 보지 않는다', () => {
    const original = [t('mom', { userId: 'u-mom', condition: { continuousMin: 20, dayMin: 90 } })]
    const reordered = [{ ...original[0], condition: { dayMin: 90, continuousMin: 20 } }]
    expect(markSelfFilled(original, reordered, 'u-mom')[0].filledBySelf).toBe(false)
  })
})

describe('값 비교(sameValue)', () => {
  it('키 순서가 달라도 같은 값이다 (안쪽 객체도)', () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(sameValue({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(true)
  })

  it('없는 칸은 undefined·null·생략이 모두 같다', () => {
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue({ a: undefined }, {})).toBe(true)
  })

  it('값이 다르면 다르다 (0·false 는 "없음"이 아니다, 배열은 순서가 있다)', () => {
    expect(sameValue({ continuousMin: 20 }, { continuousMin: 30 })).toBe(false)
    expect(sameValue(0, undefined)).toBe(false)
    expect(sameValue(false, undefined)).toBe(false)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
  })

  it('conditionChanged: 조건 칸만 본다 (이름표·계정 연결은 보지 않는다)', () => {
    const before = t('mom', { userId: 'u-mom', age: 68, condition: { continuousMin: 20, dayMin: 90 } })
    expect(conditionChanged(before, { ...before, label: '어머니', userId: undefined })).toBe(false)
    expect(conditionChanged(before, { ...before, condition: { dayMin: 90, continuousMin: 20 } })).toBe(false)
    expect(conditionChanged(before, { ...before, age: 69 })).toBe(true)
    expect(conditionChanged(before, { ...before, condition: { continuousMin: 25, dayMin: 90 } })).toBe(true)
  })
})
