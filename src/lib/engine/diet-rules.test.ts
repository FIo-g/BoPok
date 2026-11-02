import { describe, expect, it } from 'vitest'
import {
  DietRuleSchema,
  FoodTagSchema,
  HealthConditionSchema,
  MedicationClassSchema,
  type DietRule,
} from '@/lib/contracts'
import { AI_AVOID_RULES, DIET_RULES, validateDietRules } from './diet-rules'
import { avoidFoodTags } from './diet'

// 근거 없는 "주의/괜찮아요"를 막는 안전망 (설계 4.4, 7장). 규칙이 하나라도 출처·확인 날짜·근거 문장이 없거나
// 신뢰 등급이 C이면 validateDietRules가 문제를 돌려주고, 아래 첫 묶음이 실제 표(DIET_RULES)에서 바로 실패한다.
describe('AI_AVOID_RULES (AI에 "피할 음식"으로 보내는 규칙)', () => {
  it('와파린 잎채소 규칙만 뺀다 — 근거가 "피하라"가 아니라 "비타민 K 양을 일정하게"라서', () => {
    expect(AI_AVOID_RULES.map(rule => rule.id)).not.toContain('warfarin-leafy-greens')
    expect(AI_AVOID_RULES).toHaveLength(DIET_RULES.length - 1)
  })
  it('와파린만 드시는 분이면 AI에는 술만 간다 (화면 주의에는 잎채소도 그대로 나온다)', () => {
    const warfarinOnly = [
      {
        tripId: 'trip1',
        travelerId: 't1',
        conditions: [],
        medicationClasses: ['warfarin' as const],
        visibility: 'group' as const,
        consentAt: '2026-11-02T00:00:00.000Z',
        enteredByUserId: 'u1',
      },
    ]
    expect(avoidFoodTags(warfarinOnly, AI_AVOID_RULES)).toEqual(['alcohol'])
    expect(avoidFoodTags(warfarinOnly, DIET_RULES)).toEqual(['alcohol', 'leafy_greens'])
  })
})

describe('DIET_RULES — 실제 규칙 표', () => {
  it('질병관리청 국가건강정보포털에서 옮긴 22줄이다', () => {
    expect(DIET_RULES).toHaveLength(22)
    for (const rule of DIET_RULES) {
      expect(rule.source, rule.id).toContain('질병관리청 국가건강정보포털')
    }
  })

  it('validateDietRules가 문제를 하나도 찾지 못한다', () => {
    expect(validateDietRules(DIET_RULES)).toEqual([])
  })

  it('모든 규칙이 DietRuleSchema를 통과하고 음식 태그·병·약 종류가 목록 안의 값이다', () => {
    for (const rule of DIET_RULES) {
      expect(DietRuleSchema.safeParse(rule).success, rule.id).toBe(true)
      expect(FoodTagSchema.options, rule.id).toContain(rule.foodTag)
      if (rule.reasonKind === 'condition') {
        expect(HealthConditionSchema.options, rule.id).toContain(rule.condition)
      } else {
        expect(MedicationClassSchema.options, rule.id).toContain(rule.medicationClass)
      }
    }
  })

  it('항응고제 규칙은 와파린에만 걸려 있다 (새 항응고제는 비타민 K의 영향이 없다고 포털이 적었다)', () => {
    const medicationRules = DIET_RULES.filter((rule) => rule.reasonKind === 'medication')
    const warfarinTags = medicationRules
      .filter((rule) => rule.medicationClass === 'warfarin')
      .map((rule) => rule.foodTag)
      .sort()
    expect(warfarinTags).toEqual(['alcohol', 'leafy_greens'])
    expect(medicationRules.map((rule) => rule.medicationClass).sort()).toEqual([
      'calcium_channel_blocker',
      'warfarin',
      'warfarin',
    ])
  })
})

describe('validateDietRules', () => {
  const valid: DietRule = {
    id: 'test-rule',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'sugary',
    sentence: '설탕이나 꿀 등 단순당의 섭취를 주의합니다.',
    source: '질병관리청 국가건강정보포털 「당뇨환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  }

  it('근거가 갖춰진 규칙은 문제가 없다 (A·B 등급, 연-월과 연-월-일 날짜)', () => {
    expect(validateDietRules([valid])).toEqual([])
    expect(validateDietRules([{ ...valid, confidence: 'B', checkedAt: '2026-11' }])).toEqual([])
    expect(validateDietRules([])).toEqual([])
  })

  it('C 등급 규칙은 문제로 돌려준다', () => {
    const problems = validateDietRules([{ ...valid, confidence: 'C' }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('test-rule')
  })

  it('출처가 비었거나 공백뿐이면 문제로 돌려준다', () => {
    expect(validateDietRules([{ ...valid, source: '' }])).not.toEqual([])
    expect(validateDietRules([{ ...valid, source: '   ' }])).not.toEqual([])
    // 타입은 막아 주지만, 런타임에 손으로 만든 값이 들어와도 걸러야 한다.
    expect(validateDietRules([{ ...valid, source: undefined } as unknown as DietRule])).not.toEqual([])
  })

  it('근거 문장이 비었거나 공백뿐이면 문제로 돌려준다', () => {
    expect(validateDietRules([{ ...valid, sentence: '' }])).not.toEqual([])
    expect(validateDietRules([{ ...valid, sentence: ' \n ' }])).not.toEqual([])
  })

  it('id가 겹치면 문제로 돌려준다', () => {
    const problems = validateDietRules([valid, { ...valid, foodTag: 'salty' }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('test-rule')
  })

  it('확인 날짜가 YYYY-MM 또는 YYYY-MM-DD 모양이 아니면 문제로 돌려준다', () => {
    for (const checkedAt of ['', '   ', '2026', '2026-1-2', '2026/11/02', '11월 2일', '2026-11-02T00:00:00Z', 'yesterday']) {
      expect(validateDietRules([{ ...valid, checkedAt }]), checkedAt).not.toEqual([])
    }
  })

  it('"예시"로 시작하는 문장은 문제로 돌려준다 (가짜 근거를 막는다)', () => {
    expect(validateDietRules([{ ...valid, sentence: '예시: 단 음식은 피하세요.' }])).not.toEqual([])
    expect(validateDietRules([{ ...valid, sentence: '  예시 문장입니다.' }])).not.toEqual([])
  })

  it('목록 밖 값(스키마 위반)은 문제로 돌려준다', () => {
    const bad = { ...valid, foodTag: 'coffee' } as unknown as DietRule
    expect(validateDietRules([bad])).not.toEqual([])
  })

  it('문제가 여러 줄에 있으면 모두 모아 돌려준다', () => {
    const problems = validateDietRules([
      { ...valid, id: 'a', confidence: 'C' },
      { ...valid, id: 'b', source: ' ' },
      { ...valid, id: 'c' },
    ])
    expect(problems.some((problem) => problem.includes('"a"'))).toBe(true)
    expect(problems.some((problem) => problem.includes('"b"'))).toBe(true)
    expect(problems.every((problem) => !problem.includes('"c"'))).toBe(true)
  })
})
