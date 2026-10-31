import { describe, expect, it } from 'vitest'
import type { Traveler } from '@/lib/contracts'
import { canClaim, claimTraveler, markSelfFilled, myTraveler, releaseTraveler } from './travelers'

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
})
