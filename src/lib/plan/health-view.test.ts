import { describe, expect, it } from 'vitest'
import type { DietRule, FoodTag, MenuItem, PlaceDetail, Stop, Traveler, TravelerHealth } from '@/lib/contracts'
import { FOOD_TAG_LABEL, HEALTH_CONDITION_LABEL, MEDICATION_CLASS_LABEL } from '@/lib/contracts'
import { healthSlotView } from './health-view'

// 규칙은 계산이 문장·출처·확인 날짜를 그대로 옮기는지 보려는 예시다. 실제 규칙 표(DIET_RULES)의 근거 문장이 아니다.
const sugaryForDiabetes: DietRule = {
  id: 'diabetes-sugary',
  reasonKind: 'condition',
  condition: 'diabetes',
  foodTag: 'sugary',
  sentence: '예시 근거 문장: 단 음식은 주의해요.',
  source: '예시 출처 A',
  checkedAt: '2026-11-02',
  confidence: 'A',
}
const saltyForHypertension: DietRule = {
  id: 'hypertension-salty',
  reasonKind: 'condition',
  condition: 'hypertension',
  foodTag: 'salty',
  sentence: '예시 근거 문장: 짠 음식은 줄여요.',
  source: '예시 출처 B',
  checkedAt: '2026-11-03',
  confidence: 'B',
}
const grapefruitForCcb: DietRule = {
  id: 'ccb-grapefruit',
  reasonKind: 'medication',
  medicationClass: 'calcium_channel_blocker',
  foodTag: 'grapefruit',
  sentence: '예시 근거 문장: 자몽은 약 효과를 바꿀 수 있어요.',
  source: '예시 출처 C',
  checkedAt: '2026-11-02',
  confidence: 'A',
}
// 병 때문에 자몽을 조심하는 규칙은 실제 표에 없지만, "일부 약만 해당" 문구가 약 규칙에만 붙는지 가르려는 가짜 규칙이다.
const grapefruitForGout: DietRule = {
  id: 'gout-grapefruit',
  reasonKind: 'condition',
  condition: 'gout',
  foodTag: 'grapefruit',
  sentence: '예시 근거 문장: 병 때문에 자몽을 조심해요.',
  source: '예시 출처 D',
  checkedAt: '2026-11-02',
  confidence: 'A',
}
const rules: DietRule[] = [sugaryForDiabetes, saltyForHypertension, grapefruitForCcb, grapefruitForGout]

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

function traveler(id: string, label: string): Traveler {
  return { id, label, pace: 'normal', mobilityAid: false, isParent: false, condition: {}, filledBySelf: false }
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

function stop(key: string, placeId: string | null, name = placeId ? `장소 ${placeId}` : '점심'): Stop {
  return { key, placeId, name, mustVisit: false, arriveBy: 'car', skipSegmentIds: [], detourMap: {}, restNodeIds: [] }
}

const mom = traveler('t1', '엄마')
const dad = traveler('t2', '아빠')
const diabetic = health('t1', { conditions: ['diabetes'] })

describe('healthSlotView', () => {
  it('받은 건강 정보가 없으면 hidden — 메뉴가 있어도 아무것도 그리지 않는다', () => {
    const view = healthSlotView({
      health: [],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      travelers: [mom],
      rules,
    })
    expect(view).toEqual({ kind: 'hidden' })
  })

  it('건강 정보는 있는데 그날 장소에 메뉴 정보가 없으면 no_menus — "주의 없음"이 아니다', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1'), stop('s2', 'p2'), stop('s3', null)],
      // p1은 메뉴 칸 자체가 없고, p2는 빈 배열이고, p3은 stops에 없는 곳이다
      places: { p1: place('p1'), p2: place('p2', []), p3: place('p3', [menu('단팥죽', ['sugary'])]) },
      travelers: [mom],
      rules,
    })
    expect(view).toEqual({ kind: 'no_menus' })
  })

  it('장소 상세를 아직 못 받았거나 일정이 비어 있어도 no_menus', () => {
    expect(healthSlotView({ health: [diabetic], stops: [stop('s1', 'p1')], places: {}, travelers: [mom], rules })).toEqual({ kind: 'no_menus' })
    expect(healthSlotView({ health: [diabetic], stops: [], places: {}, travelers: [mom], rules })).toEqual({ kind: 'no_menus' })
  })

  it('메뉴는 있는데 규칙 표에 맞는 조합이 없으면 no_cautions', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('냉면', ['salty'])]) },
      travelers: [mom],
      rules,
    })
    expect(view).toEqual({ kind: 'no_cautions', uncheckedMeals: [] })
  })

  it('주의가 있으면 rows — 이름표·한국어 태그·규칙 표 문장·출처·확인 날짜를 그대로 옮긴다', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1', '성심당 본점')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      travelers: [mom],
      rules,
    })
    expect(view).toEqual({
      kind: 'cautions',
      rows: [
        {
          stopKey: 's1',
          placeName: '성심당 본점',
          menuName: '단팥죽',
          foodTagLabel: FOOD_TAG_LABEL.sugary,
          travelerLabel: '엄마',
          reason: HEALTH_CONDITION_LABEL.diabetes,
          sentence: sugaryForDiabetes.sentence,
          source: '예시 출처 A',
          checkedAt: '2026-11-02',
          partialMedication: false,
        },
      ],
      uncheckedMeals: [],
    })
  })

  it('칼슘채널차단제 + 자몽 → partialMedication true (약마다 달라서 "일부 약만 해당" 한 줄을 더한다)', () => {
    const view = healthSlotView({
      health: [health('t1', { medicationClasses: ['calcium_channel_blocker'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('자몽 에이드', ['grapefruit'])]) },
      travelers: [mom],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]).toMatchObject({ foodTagLabel: FOOD_TAG_LABEL.grapefruit, reason: MEDICATION_CLASS_LABEL.calcium_channel_blocker, partialMedication: true })
  })

  it('병 때문에 걸린 자몽은 partialMedication이 아니다', () => {
    const view = healthSlotView({
      health: [health('t1', { conditions: ['gout'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('자몽 에이드', ['grapefruit'])]) },
      travelers: [mom],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.rows[0].partialMedication).toBe(false)
  })

  it('약 때문이어도 자몽이 아니면 partialMedication이 아니다', () => {
    const warfarinLeafy: DietRule = {
      id: 'warfarin-leafy',
      reasonKind: 'medication',
      medicationClass: 'warfarin',
      foodTag: 'leafy_greens',
      sentence: '예시 근거 문장: 잎채소 양을 일정하게 유지해요.',
      source: '예시 출처 E',
      checkedAt: '2026-11-02',
      confidence: 'A',
    }
    const view = healthSlotView({
      health: [health('t1', { medicationClasses: ['warfarin'] })],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('쌈밥', ['leafy_greens'])]) },
      travelers: [mom],
      rules: [warfarinLeafy],
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.rows[0].partialMedication).toBe(false)
  })

  it('여행자를 못 찾으면 "함께 가는 분"으로 쓴다', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      travelers: [dad],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.rows[0].travelerLabel).toBe('함께 가는 분')
  })

  it('stops에 넘긴 장소만 계산한다 — 다른 날 장소(places에만 있는 것)는 들어가지 않는다', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1')],
      places: {
        p1: place('p1', [menu('냉면', ['salty'])]),
        p2: place('p2', [menu('단팥죽', ['sugary'])]), // 다른 날 장소
      },
      travelers: [mom],
      rules,
    })
    expect(view).toEqual({ kind: 'no_cautions', uncheckedMeals: [] })
  })

  it('순서는 장소 순서를 지키고 같은 장소의 줄은 이어서 나온다', () => {
    const view = healthSlotView({
      health: [health('t1', { conditions: ['diabetes', 'hypertension'] }), health('t2', { conditions: ['diabetes'] })],
      stops: [stop('s1', 'p1'), stop('s2', 'p2')],
      places: {
        p1: place('p1', [menu('팥빙수', ['sugary']), menu('칼국수', ['salty'])]),
        p2: place('p2', [menu('호떡', ['sugary'])]),
      },
      travelers: [mom, dad],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.rows.map(row => [row.stopKey, row.menuName, row.travelerLabel])).toEqual([
      ['s1', '팥빙수', '엄마'],
      ['s1', '팥빙수', '아빠'],
      ['s1', '칼국수', '엄마'],
      ['s2', '호떡', '엄마'],
      ['s2', '호떡', '아빠'],
    ])
  })

  it("places 조회는 자기 키만 본다 — placeId가 'constructor'여도 터지지 않는다", () => {
    const view = healthSlotView({ health: [diabetic], stops: [stop('s1', 'constructor')], places: {}, travelers: [mom], rules })
    expect(view).toEqual({ kind: 'no_menus' })
  })

  it('같은 장소가 일정에 두 번 있어도 메뉴 줄은 장소마다 그대로 나온다 (stopKey가 다르다)', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1'), stop('s2', 'p1')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]) },
      travelers: [mom],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.rows.map(row => row.stopKey)).toEqual(['s1', 's2'])
  })

  it('메뉴가 없는 식당·카페와 장소 DB에 없는 식사 자리는 "확인하지 못한 식사 자리"로 따로 알린다 (관광지는 넣지 않는다)', () => {
    const restaurantNoMenu: PlaceDetail = { ...place('p2'), kind: 'restaurant' }
    const cafeNoMenu: PlaceDetail = { ...place('p3', []), kind: 'cafe' }
    const attraction: PlaceDetail = { ...place('p4'), kind: 'attraction' }
    const lunch: Stop = { ...stop('s5', null, '점심 식사'), seated: true }
    const walk: Stop = stop('s6', null, '산책')
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1'), stop('s2', 'p2', '칼국수집'), stop('s3', 'p3', '카페'), stop('s4', 'p4', '한밭수목원'), lunch, walk],
      places: { p1: place('p1', [menu('냉면', ['salty'])]), p2: restaurantNoMenu, p3: cafeNoMenu, p4: attraction },
      travelers: [mom],
      rules,
    })
    // 주의가 없어도 "그날 전체를 확인했다"는 뜻이 아니게, 확인 못 한 곳 이름을 함께 돌려준다
    expect(view).toEqual({ kind: 'no_cautions', uncheckedMeals: ['칼국수집', '카페', '점심 식사'] })
  })

  it('음식 태그가 빈 메뉴(수집한 메뉴)는 확인한 메뉴로 보지 않는다 — 태그 있는 메뉴가 없으면 no_menus', () => {
    // 김경선 PR #29 리뷰: 당뇨 + 태그 없는 메뉴가 no_cautions·빈 uncheckedMeals로 나와 "확인 못 함" 안내가 사라졌다
    const imported: PlaceDetail = { ...place('p2', [menu('칼국수', []), menu('보리밥', [])]), kind: 'restaurant' }
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p2', '칼국수집')],
      places: { p2: imported },
      travelers: [mom],
      rules,
    })
    expect(view).toEqual({ kind: 'no_menus' })
  })

  it('태그 있는 메뉴가 다른 곳에 있어도 태그가 빈 메뉴가 있는 식당은 확인하지 못한 식사 자리로 알린다', () => {
    const imported: PlaceDetail = { ...place('p2', [menu('칼국수', [])]), kind: 'restaurant' }
    const partly: PlaceDetail = { ...place('p3', [menu('단팥빵', ['sugary']), menu('우유', [])]), kind: 'cafe' }
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1'), stop('s2', 'p2', '칼국수집'), stop('s3', 'p3', '빵집')],
      places: { p1: place('p1', [menu('냉면', ['salty'])]), p2: imported, p3: partly },
      travelers: [mom],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    // 단팥빵 주의는 그대로 보이고, 태그가 다 붙지 않은 두 곳은 따로 알린다
    expect(view.rows.map(row => row.menuName)).toEqual(['단팥빵'])
    expect(view.uncheckedMeals).toEqual(['칼국수집', '빵집'])
  })

  it('주의가 있는 날에도 확인하지 못한 식사 자리를 함께 돌려준다', () => {
    const view = healthSlotView({
      health: [diabetic],
      stops: [stop('s1', 'p1'), stop('s2', 'p2', '칼국수집')],
      places: { p1: place('p1', [menu('단팥죽', ['sugary'])]), p2: { ...place('p2'), kind: 'restaurant' } },
      travelers: [mom],
      rules,
    })
    expect(view.kind).toBe('cautions')
    if (view.kind !== 'cautions') return
    expect(view.uncheckedMeals).toEqual(['칼국수집'])
  })
})
