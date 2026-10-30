import { describe, expect, it } from 'vitest'
import { TravelerSchema } from '@/lib/contracts'
import { CONDITION_QUESTIONS, conditionFromAnswers } from './condition'

describe('condition', () => {
  it('모두 두 번째 선택지 → 20/60/10분, 계단 괜찮음, 보통, 보조기구 없음', () => {
    expect(conditionFromAnswers({ continuousMin: 1, dayMin: 1, restMin: 1, avoidStairs: 1, pace: 1, mobilityAid: 1 })).toEqual({
      condition: { continuousMin: 20, dayMin: 60, restMin: 10, avoidStairs: false }, pace: 'normal', mobilityAid: false,
    })
  })

  it('아무것도 안 고르면 칸은 비우고 속도는 unknown', () => {
    const r = conditionFromAnswers({})
    expect(r).toEqual({ condition: {}, pace: 'unknown', mobilityAid: false })
    expect(Object.keys(r.condition)).toEqual([])
  })

  it('null·범위 밖 번호는 잘 모르겠어요', () => {
    expect(conditionFromAnswers({ continuousMin: null, dayMin: 3, restMin: -1 }).condition).toEqual({})
  })

  it('첫·마지막 선택지 값', () => {
    expect(conditionFromAnswers({ continuousMin: 0, dayMin: 2, restMin: 2, avoidStairs: 0, pace: 0, mobilityAid: 0 })).toEqual({
      condition: { continuousMin: 10, dayMin: 90, restMin: 20, avoidStairs: true }, pace: 'slow', mobilityAid: true,
    })
  })

  it('보조기구만 잘 모르겠어요가 없다', () => {
    expect(CONDITION_QUESTIONS.filter(q => !q.allowUnknown).map(q => q.id)).toEqual(['mobilityAid'])
  })

  it('질문 순서', () => {
    expect(CONDITION_QUESTIONS.map(q => q.id)).toEqual(['continuousMin', 'dayMin', 'restMin', 'avoidStairs', 'pace', 'mobilityAid'])
  })

  it('결과는 여행자 스키마의 조건으로 통과', () => {
    expect(TravelerSchema.shape.condition.safeParse(conditionFromAnswers({ continuousMin: 2 }).condition).success).toBe(true)
  })

  it("계단 피하기 선택지 note는 '계단을 피하는 길로 계산해요'", () => {
    const avoid = CONDITION_QUESTIONS.find(q => q.id === 'avoidStairs')!
    expect(avoid.choices[0]).toMatchObject({ label: '피하고 싶어요', note: '계단을 피하는 길로 계산해요' })
  })
})
