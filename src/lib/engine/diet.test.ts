import { describe, expect, it } from 'vitest'
import type { DietRule, FoodTag, MenuItem, PlaceDetail, Stop, TravelerHealth } from '@/lib/contracts'
import { DietCautionSchema, HEALTH_CONDITION_LABEL, MEDICATION_CLASS_LABEL } from '@/lib/contracts'
import { avoidFoodTags, dietCautions } from './diet'

// 규칙 표(DIET_RULES)는 근거 확인 전이라 비어 있다. 동작은 여기서 만든 예시 규칙으로만 검사한다.
// 예시 문구는 실제 근거 문장이 아니다 — 계산이 출처·확인 날짜·문장을 그대로 옮기는지만 본다.
const sugaryForDiabetes: DietRule = {
  id: 'diabetes-sugary',
  reasonKind: 'condition',
  condition: 'diabetes',
  foodTag: 'sugary',
  sentence: '예시 근거 문장: 당뇨가 있으면 단 음식은 혈당을 빨리 올릴 수 있어요.',
  source: '예시 출처 A',
  checkedAt: '2026-11-02',
  confidence: 'A',
}
const saltyForHypertension: DietRule = {
  id: 'hypertension-salty',
  reasonKind: 'condition',
  condition: 'hypertension',
  foodTag: 'salty',
  sentence: '예시 근거 문장: 고혈압이 있으면 짠 음식은 줄이는 것이 좋아요.',
  source: '예시 출처 B',
  checkedAt: '2026-11',
  confidence: 'B',
}
const grapefruitForCcb: DietRule = {
  id: 'ccb-grapefruit',
  reasonKind: 'medication',
  medicationClass: 'calcium_channel_blocker',
  foodTag: 'grapefruit',
  sentence: '예시 근거 문장: 이 계열 혈압약은 자몽과 함께 먹으면 약 효과가 달라질 수 있어요.',
  source: '예시 출처 C',
  checkedAt: '2026-11-02',
  confidence: 'A',
}
const saltyForKidney: DietRule = {
  id: 'kidney-salty',
  reasonKind: 'condition',
  condition: 'kidney_disease',
  foodTag: 'salty',
  sentence: '예시 근거 문장: 신장 질환이 있으면 짠 음식에 주의해요.',
  source: '예시 출처 D',
  checkedAt: '2026-11-02',
  confidence: 'B',
}
const rules: DietRule[] = [sugaryForDiabetes, saltyForHypertension, grapefruitForCcb, saltyForKidney]

function health(travelerId: string, over: Partial<TravelerHealth> = {}): TravelerHealth {
  return {
    tripId: 'trip1',
    travelerId,
    conditions: [],
    medicationClasses: [],
    visibility: 'group',
    consentAt: '2026-11-02T00:00:00.000Z',
    enteredByUserId: 'u1',
    ...over,
  }
}

function menu(name: string, foodTags: FoodTag[]): MenuItem {
  return { name, foodTags, confidence: 'B' }
}

function place(id: string, menus?: MenuItem[]): PlaceDetail {
  return {
    id,
    name: `장소 ${id}`,
    category: '식당',
    styles: [],
    coord: [127.38, 36.35],
    seated: true,
    indoor: true,
    confidence: 'B',
    nodes: [],
    segments: [],
    menus,
  }
}

function stop(key: string, placeId: string | null): Stop {
  return {
    key,
    placeId,
    name: placeId ? `장소 ${placeId}` : '점심',
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
  }
}

const diabetic = health('t1', { conditions: ['diabetes'] })

describe('dietCautions', () => {
  it('당뇨 + 단 음식 메뉴 → 주의 1줄, 출처·확인 날짜·문장을 규칙 그대로 옮긴다', () => {
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      rules,
    })
    expect(result).toEqual([
      {
        stopKey: 's1',
        menuName: '단팥죽',
        foodTag: 'sugary',
        travelerId: 't1',
        reasonKind: 'condition',
        reason: HEALTH_CONDITION_LABEL.diabetes,
        sentence: sugaryForDiabetes.sentence,
        source: '예시 출처 A',
        checkedAt: '2026-11-02',
      },
    ])
    expect(DietCautionSchema.array().safeParse(result).success).toBe(true)
  })

  it('복용 약 종류가 규칙에 맞으면 약 종류의 한국어 이름을 이유로 쓴다', () => {
    const result = dietCautions({
      health: [health('t1', { medicationClasses: ['calcium_channel_blocker'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('자몽 에이드', ['grapefruit', 'sugary'])]) },
      rules,
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      menuName: '자몽 에이드',
      foodTag: 'grapefruit',
      reasonKind: 'medication',
      reason: MEDICATION_CLASS_LABEL.calcium_channel_blocker,
      source: '예시 출처 C',
    })
  })

  it('해당 없는 병이면 0줄', () => {
    const result = dietCautions({
      health: [health('t1', { conditions: ['gout'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary']), menu('젓갈 백반', ['salty'])]) },
      rules,
    })
    expect(result).toEqual([])
  })

  it('메뉴에 규칙이 걸린 음식 태그가 없으면 0줄', () => {
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('나물 비빔밥', ['leafy_greens']), menu('맑은 국', [])]) },
      rules,
    })
    expect(result).toEqual([])
  })

  it('메뉴가 없거나 비어 있는 장소 → 0줄', () => {
    const noMenus = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1') },
      rules,
    })
    const emptyMenus = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', []) },
      rules,
    })
    expect(noMenus).toEqual([])
    expect(emptyMenus).toEqual([])
  })

  it('placeId가 null이거나 장소 상세가 없는 일정 장소는 건너뛴다', () => {
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', null), stop('s2', 'missing'), stop('s3', 'constructor')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      rules,
    })
    expect(result).toEqual([])
  })

  it('두 사람이 같은 메뉴에 걸리면 사람마다 1줄, travelerId 순', () => {
    const result = dietCautions({
      health: [health('t2', { conditions: ['diabetes'] }), health('t1', { conditions: ['diabetes'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      rules,
    })
    expect(result.map((caution) => caution.travelerId)).toEqual(['t1', 't2'])
  })

  it('같은 메뉴의 태그가 중복되어도 1줄', () => {
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary', 'sugary'])]) },
      rules,
    })
    expect(result).toHaveLength(1)
  })

  it('같은 병·태그에 규칙이 두 줄이어도 같은 (장소, 메뉴, 태그, 사람, 이유)는 1줄', () => {
    const duplicate: DietRule = { ...sugaryForDiabetes, id: 'diabetes-sugary-2', source: '예시 출처 Z' }
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      rules: [sugaryForDiabetes, duplicate],
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('예시 출처 A')
  })

  it('병이 달라 이유가 다르면 같은 태그여도 따로 한 줄씩', () => {
    const result = dietCautions({
      health: [health('t1', { conditions: ['hypertension', 'kidney_disease'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('젓갈 백반', ['salty'])]) },
      rules,
    })
    expect(result.map((caution) => caution.reason).sort()).toEqual(
      [HEALTH_CONDITION_LABEL.hypertension, HEALTH_CONDITION_LABEL.kidney_disease].sort(),
    )
  })

  it('정렬: 일정 장소 순서 → 메뉴 순서 → travelerId (입력 순서와 무관)', () => {
    const result = dietCautions({
      health: [
        health('t2', { conditions: ['diabetes', 'hypertension'] }),
        health('t1', { conditions: ['diabetes'] }),
      ],
      // places 객체의 키 순서(p2가 먼저)와 일정 순서(s1=p1, s2=p2)가 다르다
      stops: [stop('s1', 'p1'), stop('s2', 'p2')],
      places: {
        p2: place('p2', [menu('떡볶이', ['salty'])]),
        p1: place('p1', [menu('젓갈 백반', ['salty']), menu('단팥죽', ['sugary'])]),
      },
      rules,
    })
    expect(result.map((caution) => [caution.stopKey, caution.menuName, caution.travelerId])).toEqual([
      ['s1', '젓갈 백반', 't2'],
      ['s1', '단팥죽', 't1'],
      ['s1', '단팥죽', 't2'],
      ['s2', '떡볶이', 't2'],
    ])
  })

  it('같은 장소를 두 번 들르면 일정 장소(stopKey)마다 따로 센다', () => {
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1'), stop('s2', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      rules,
    })
    expect(result.map((caution) => caution.stopKey)).toEqual(['s1', 's2'])
  })

  it('건강 정보가 비었거나 병·약이 하나도 없으면 []', () => {
    const places = { p1: place('p1', [menu('단팥죽', ['sugary'])]) }
    const stops = [stop('s1', 'p1')]
    expect(dietCautions({ health: [], stops, places, rules })).toEqual([])
    expect(dietCautions({ health: [health('t1')], stops, places, rules })).toEqual([])
  })

  it('규칙 표가 비어 있으면 []', () => {
    const result = dietCautions({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      rules: [],
    })
    expect(result).toEqual([])
  })
})

describe('avoidFoodTags', () => {
  it('일행 전체의 병·약에 걸리는 태그를 이름순으로, 중복 없이 돌려준다', () => {
    const result = avoidFoodTags(
      [
        health('t1', { conditions: ['hypertension'] }),
        health('t2', { conditions: ['kidney_disease', 'diabetes'] }), // salty가 두 규칙에 걸림
        health('t3', { medicationClasses: ['calcium_channel_blocker'] }),
      ],
      rules,
    )
    expect(result).toEqual(['grapefruit', 'salty', 'sugary'])
  })

  it('해당 없는 병·약이면 []', () => {
    expect(avoidFoodTags([health('t1', { conditions: ['gout'] })], rules)).toEqual([])
  })

  it('건강 정보가 비었으면 []', () => {
    expect(avoidFoodTags([], rules)).toEqual([])
    expect(avoidFoodTags([health('t1')], rules)).toEqual([])
  })

  it('규칙 표가 비어 있으면 []', () => {
    expect(avoidFoodTags([diabetic], [])).toEqual([])
  })

  it('입력 배열을 바꾸지 않는다', () => {
    const input = [health('t2', { conditions: ['diabetes'] }), health('t1', { conditions: ['hypertension'] })]
    const before = structuredClone(input)
    avoidFoodTags(input, rules)
    dietCautions({ health: input, stops: [], places: {}, rules })
    expect(input).toEqual(before)
  })
})
