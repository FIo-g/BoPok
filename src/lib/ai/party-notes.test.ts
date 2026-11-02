// 일행 참고 줄 검사. 프롬프트에는 음식 태그 이름과 "운동 거의 안 함 → 더 쉬게" 한 줄만 간다.
import { describe, expect, it, vi } from 'vitest'
import type { FoodTag, Traveler } from '@/lib/contracts'
import { avoidFoodLine, exerciseLine, partyNoteLines, readAvoidFoodTags } from './party-notes'

function person(overrides: Partial<Traveler> = {}): Traveler {
  return {
    id: 't1',
    label: '엄마',
    pace: 'normal',
    mobilityAid: false,
    isParent: true,
    condition: {},
    filledBySelf: false,
    ...overrides,
  }
}

describe('avoidFoodLine', () => {
  it('태그를 받은 순서대로 한국어 이름으로 한 줄', () => {
    expect(avoidFoodLine(['sugary', 'salty'])).toBe(
      '피할 음식: 단 음식, 짠 음식 — 이런 메뉴가 많은 식당은 고르지 마라.',
    )
    // 순서를 바꾸면 줄도 바뀐다 — 받은 순서를 그대로 쓴다
    expect(avoidFoodLine(['salty', 'sugary'])).toBe(
      '피할 음식: 짠 음식, 단 음식 — 이런 메뉴가 많은 식당은 고르지 마라.',
    )
  })

  it('태그가 없으면 줄 자체가 없다', () => {
    expect(avoidFoodLine([])).toBeNull()
  })

  it('같은 태그가 겹쳐 와도 한 번만 쓴다', () => {
    const tags: FoodTag[] = ['alcohol', 'alcohol', 'fatty']
    expect(avoidFoodLine(tags)).toBe('피할 음식: 술, 기름진 음식 — 이런 메뉴가 많은 식당은 고르지 마라.')
  })
})

describe('exerciseLine', () => {
  it('운동을 거의 안 하는 여행자가 있으면 쉬는 자리 줄', () => {
    expect(exerciseLine([person(), person({ id: 't2', label: '나', exerciseFrequency: 'rarely' })])).toBe(
      '운동을 거의 안 하는 분이 함께 간다 — 쉬는 자리를 자주 넣어라.',
    )
  })

  it('다른 값이거나 비어 있으면 줄이 없다 (더 걷게 하는 쪽으로는 쓰지 않는다)', () => {
    expect(exerciseLine([person({ exerciseFrequency: 'five_plus' })])).toBeNull()
    expect(exerciseLine([person({ exerciseFrequency: 'three_four' }), person({ id: 't2', exerciseFrequency: 'one_two' })])).toBeNull()
    expect(exerciseLine([person()])).toBeNull()
    expect(exerciseLine([])).toBeNull()
  })

  it('줄에 이름표(누구인지)가 들어가지 않는다', () => {
    const line = exerciseLine([person({ label: '우리할머니', exerciseFrequency: 'rarely' })])
    expect(line).not.toBeNull()
    expect(line).not.toContain('할머니')
  })
})

describe('readAvoidFoodTags', () => {
  it('읽은 태그를 그대로 돌려준다', async () => {
    await expect(readAvoidFoodTags({ getAvoidFoodTags: async () => ['salty', 'sugary'] }, 'trip-1')).resolves.toEqual([
      'salty',
      'sugary',
    ])
  })

  it('실패하면 빈 목록, 로그에는 tripId만 (던진 값이 Error가 아니어도)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const thrown of [new Error('params: warfarin'), 'diabetes', { detail: 'hypertension' }]) {
        const tags = await readAvoidFoodTags(
          {
            getAvoidFoodTags: async () => {
              throw thrown
            },
          },
          'trip-1',
        )
        expect(tags).toEqual([])
      }
      expect(warn).toHaveBeenCalledTimes(3)
      for (const call of warn.mock.calls) expect(call).toEqual(['[ai] 피할 음식 태그를 못 읽었어요', { tripId: 'trip-1' }])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('partyNoteLines', () => {
  it('음식 줄, 운동 줄 순서로 있는 것만 돌려준다', () => {
    const rarely = person({ exerciseFrequency: 'rarely' })
    expect(partyNoteLines(['sugary'], [rarely])).toEqual([
      '피할 음식: 단 음식 — 이런 메뉴가 많은 식당은 고르지 마라.',
      '운동을 거의 안 하는 분이 함께 간다 — 쉬는 자리를 자주 넣어라.',
    ])
    expect(partyNoteLines([], [rarely])).toEqual(['운동을 거의 안 하는 분이 함께 간다 — 쉬는 자리를 자주 넣어라.'])
    expect(partyNoteLines(['salty'], [person()])).toEqual([
      '피할 음식: 짠 음식 — 이런 메뉴가 많은 식당은 고르지 마라.',
    ])
    expect(partyNoteLines([], [person()])).toEqual([])
  })
})
