import { describe, expect, it } from 'vitest'
import {
  canSeeHealth, DietCautionSchema, DietRuleSchema, HealthConditionSchema, MedicationClassSchema,
  TravelerHealthInputSchema, TravelerHealthSchema, type DietRule,
} from './index'

describe('canSeeHealth — 건강 정보가 보이는 범위', () => {
  const self = { visibility: 'self', enteredByUserId: 'u-son' } as const

  it('가족 모두면 누구나 본다', () => {
    expect(canSeeHealth({ ...self, visibility: 'group' }, 'u-daughter', 'u-mom')).toBe(true)
  })

  it('본인만 + 계정 있는 여행자는 그 사람만', () => {
    expect(canSeeHealth(self, 'u-mom', 'u-mom')).toBe(true)
    expect(canSeeHealth(self, 'u-son', 'u-mom')).toBe(false) // 대신 입력했어도 계정 있는 본인이 우선
  })

  it('본인만 + 계정 없는 여행자(할머니)는 대신 입력한 사람만', () => {
    expect(canSeeHealth(self, 'u-son', null)).toBe(true)
    expect(canSeeHealth(self, 'u-daughter', null)).toBe(false)
  })

  it('세 번째 인자를 빠뜨리면 컴파일 오류 (계정 없음은 null로 분명히 적는다)', () => {
    // @ts-expect-error travelerUserId는 필수다 — undefined와 "계정 없음"을 헷갈리지 않게 하려는 것이다
    canSeeHealth(self, 'u-son')
  })

  it('가족 모두면 계정 없는 여행자(null)여도 누구나 본다 (그룹 구성원인지는 API가 먼저 검사한다)', () => {
    expect(canSeeHealth({ ...self, visibility: 'group' }, 'u-daughter', null)).toBe(true)
  })
})

describe('건강 정보 입력', () => {
  const body = { conditions: ['diabetes'], medicationClasses: [], visibility: 'self' }

  it('동의 없이 저장 요청은 거부', () => {
    expect(TravelerHealthInputSchema.safeParse(body).success).toBe(false)
    expect(TravelerHealthInputSchema.safeParse({ ...body, consent: false }).success).toBe(false)
    expect(TravelerHealthInputSchema.safeParse({ ...body, consent: true }).success).toBe(true)
  })

  it('목록 밖 병은 거부', () => {
    expect(HealthConditionSchema.safeParse('cold').success).toBe(false)
    expect(TravelerHealthInputSchema.safeParse({ ...body, conditions: ['cold'], consent: true }).success).toBe(false)
  })

  it('목록 밖 약 종류와 보이는 범위는 거부', () => {
    expect(MedicationClassSchema.safeParse('antibiotic').success).toBe(false)
    expect(TravelerHealthInputSchema.safeParse({ ...body, visibility: 'public', consent: true }).success).toBe(false)
  })
})

describe('TravelerHealth — 저장 모양', () => {
  const health = {
    tripId: 'trip1',
    travelerId: 't-mom',
    conditions: ['diabetes', 'hypertension'],
    medicationClasses: ['anticoagulant'],
    visibility: 'self',
    consentAt: '2026-11-02T01:23:45.000Z',
    enteredByUserId: 'u-son',
  }

  it('동의 날짜는 ISO 날짜·시각이어야 한다', () => {
    expect(TravelerHealthSchema.safeParse(health).success).toBe(true)
    expect(TravelerHealthSchema.safeParse({ ...health, consentAt: '2026-11-02' }).success).toBe(false)
    expect(TravelerHealthSchema.safeParse({ ...health, consentAt: undefined }).success).toBe(false)
  })

  it('저장 키는 (tripId, travelerId)라 tripId가 꼭 있어야 한다', () => {
    expect(TravelerHealthSchema.safeParse({ ...health, tripId: undefined }).success).toBe(false)
    expect(TravelerHealthSchema.safeParse({ ...health, tripId: '' }).success).toBe(false)
  })

  it('약봉투 사진 같은 칸을 담지 않는다 (읽고 바로 버린다)', () => {
    // 들어온 사진 칸은 파싱 결과에서 사라진다. 사진 데이터가 저장·응답으로 번지지 않게 하는 안전망.
    const parsed = TravelerHealthSchema.parse({ ...health, photo: 'data:image/jpeg;base64,AAAA' })
    expect(Object.keys(parsed).sort()).toEqual(
      ['conditions', 'consentAt', 'enteredByUserId', 'medicationClasses', 'travelerId', 'tripId', 'visibility'],
    )
  })
})

describe('식단 주의 규칙·결과', () => {
  const rule = {
    id: 'r1',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'sugary',
    sentence: '단 음식은 혈당을 빠르게 올립니다',
    source: '질병관리청',
    checkedAt: '2026-11',
    confidence: 'A',
  }

  it('주의 규칙·결과는 출처와 확인 날짜가 꼭 있다', () => {
    expect(DietRuleSchema.safeParse(rule).success).toBe(true)
    expect(DietRuleSchema.safeParse({ ...rule, source: undefined }).success).toBe(false)
    expect(DietRuleSchema.safeParse({ ...rule, checkedAt: undefined }).success).toBe(false)
    expect(DietRuleSchema.safeParse({ ...rule, source: '' }).success).toBe(false)
    expect(DietRuleSchema.safeParse({ ...rule, reasonKind: 'medication' }).success).toBe(false) // medicationClass 없음
  })

  it('약 규칙은 약 종류가 있어야 하고, 병 규칙은 병이 있어야 한다', () => {
    const medicationRule = {
      id: 'r2',
      reasonKind: 'medication',
      medicationClass: 'anticoagulant',
      foodTag: 'leafy_greens',
      sentence: '비타민 K가 많은 채소는 항응고제 효과에 영향을 줄 수 있습니다',
      source: '식품의약품안전처',
      checkedAt: '2026-11',
      confidence: 'A',
    }
    expect(DietRuleSchema.safeParse(medicationRule).success).toBe(true)
    expect(DietRuleSchema.safeParse({ ...rule, condition: undefined }).success).toBe(false)
    expect(DietRuleSchema.safeParse({ ...medicationRule, medicationClass: 'aspirin' }).success).toBe(false)
  })

  it('근거 구절과 음식 태그는 목록·내용이 있어야 한다', () => {
    expect(DietRuleSchema.safeParse({ ...rule, sentence: '' }).success).toBe(false)
    expect(DietRuleSchema.safeParse({ ...rule, foodTag: 'spicy' }).success).toBe(false)
  })

  it('reasonKind로 타입이 좁혀진다', () => {
    // 컴파일이 되는 것 자체가 확인이다. 갈래마다 자기 칸만 읽을 수 있어야 한다.
    const reasonOf = (r: DietRule): string => {
      switch (r.reasonKind) {
        case 'condition':
          return r.condition
        case 'medication':
          return r.medicationClass
      }
    }
    const parsed = DietRuleSchema.parse(rule)
    expect(reasonOf(parsed)).toBe('diabetes')
  })

  const caution = {
    stopKey: 'day1-3',
    menuName: '단팥죽',
    foodTag: 'sugary',
    travelerId: 't-mom',
    reasonKind: 'condition',
    reason: '당뇨',
    sentence: '단 음식은 혈당을 빠르게 올립니다',
    source: '질병관리청',
    checkedAt: '2026-11',
  }

  it('주의 결과도 출처와 확인 날짜가 꼭 있고, 메뉴 이름은 없어도 된다', () => {
    expect(DietCautionSchema.safeParse(caution).success).toBe(true)
    expect(DietCautionSchema.safeParse({ ...caution, menuName: undefined }).success).toBe(true)
    expect(DietCautionSchema.safeParse({ ...caution, source: undefined }).success).toBe(false)
    expect(DietCautionSchema.safeParse({ ...caution, checkedAt: '' }).success).toBe(false)
    expect(DietCautionSchema.safeParse({ ...caution, sentence: '' }).success).toBe(false)
    expect(DietCautionSchema.safeParse({ ...caution, reasonKind: 'allergy' }).success).toBe(false)
  })
})
