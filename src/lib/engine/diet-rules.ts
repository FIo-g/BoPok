// 식단 주의 규칙 표: 병 또는 약 종류 → 주의할 음식 태그 → 근거 문장·출처·확인 날짜 (설계 4.4).
// AI가 아니라 사람이 근거를 확인해서 넣은 줄만 둔다. 계산(diet.ts)은 이 표에 있는 조합만 "주의"로 말한다.
//
// 출처는 질병관리청 국가건강정보포털(공공누리 4유형: 출처표시·상업적 이용금지·변경금지)이다.
// 변경금지라서 `sentence`는 원문 그대로 두고 다듬거나 요약하지 않는다. `source`·`checkedAt`·`confidence`도 조사한 값 그대로다.
// 줄마다 왜 그 짝인지, 원문이 어떤 단서(예: 와파린만 해당, 약마다 다름)를 달았는지는 근거 노트(`docs/superpowers/specs/evidence/2026-11-02-diet-rules-evidence.md`)를 본다.
// 신뢰 등급은 A/B만 쓴다 (validateDietRules). 표에 없는 조합은 "괜찮아요"가 아니라 "등록된 주의 정보 없음 (참고용)"이다.
import { DietRuleSchema } from '@/lib/contracts'
import type { DietRule } from '@/lib/contracts'

export const DIET_RULES: readonly DietRule[] = [
  {
    id: 'diabetes-sugary',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'sugary',
    sentence: '설탕이나 꿀 등 단순당의 섭취를 주의합니다.',
    source: '질병관리청 국가건강정보포털 「당뇨환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'diabetes-salty',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'salty',
    sentence: '짠 음식을 많이 먹게 되면 염분 섭취가 늘어서 혈압이 상승할 수 있으므로 싱겁게 먹는 습관을 갖도록 합니다.',
    source: '질병관리청 국가건강정보포털 「당뇨환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'diabetes-fatty',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'fatty',
    sentence: '튀김이나 볶음 요리 같은 양식과 중식은 주의하고, 기름진 음식(중식, 튀김류, 피자, 치킨, 삼겹살 등)보다는 기름기가 적은 살코기나 기름을 줄이는 조리법으로 만든 메뉴를 선택합니다.',
    source: '질병관리청 국가건강정보포털 「당뇨환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'diabetes-alcohol',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'alcohol',
    sentence: '술은 영양소가 없으면서 열량이 많으므로 마시지 않는 것이 좋습니다.',
    source: '질병관리청 국가건강정보포털 「당뇨환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'hypertension-salty',
    reasonKind: 'condition',
    condition: 'hypertension',
    foodTag: 'salty',
    sentence: '하루 소금 섭취량을 5 g(나트륨 2,000 mg) 이하로 제한할 것을 권고한다.',
    source: '질병관리청 국가건강정보포털 「고혈압 환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'hypertension-fatty',
    reasonKind: 'condition',
    condition: 'hypertension',
    foodTag: 'fatty',
    sentence: '채소와 과일을 충분히 포함하고, 지방 섭취를 제한하되, 탄수화물, 단백질 및 지질을 비롯하여 식이섬유, 미네랄, 비타민 등의 영양소가 균형 있게 포함된 식사를 권고한다.',
    source: '질병관리청 국가건강정보포털 「고혈압 환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'hypertension-alcohol',
    reasonKind: 'condition',
    condition: 'hypertension',
    foodTag: 'alcohol',
    sentence: '하루 2잔 미만으로 금주에 준하는 수준의 절주를 시행할 것을 권고한다.',
    source: '질병관리청 국가건강정보포털 「고혈압 환자의 식이요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'dyslipidemia-fatty',
    reasonKind: 'condition',
    condition: 'dyslipidemia',
    foodTag: 'fatty',
    sentence: '이상지질혈증을 예방하려면 단순히 지방 섭취를 줄이기보다, 포화지방산(삼겹살, 베이컨, 소시지 등 동물성 식품과 팜유)과 트랜스지방산(과자, 튀김류)이 많은 식품을 피하고, 불포화지방산(생선, 식물성 식품)을 중심으로 양질의 지방을 적절히 섭취하는 것이 중요합니다.',
    source: '질병관리청 국가건강정보포털 「이상지질혈증 식사요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'dyslipidemia-sugary',
    reasonKind: 'condition',
    condition: 'dyslipidemia',
    foodTag: 'sugary',
    sentence: '간식으로는 생과일과 흰 우유를 권장하며, 단 음료나 디저트는 피하는 것이 좋습니다.',
    source: '질병관리청 국가건강정보포털 「이상지질혈증 식사요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'dyslipidemia-alcohol',
    reasonKind: 'condition',
    condition: 'dyslipidemia',
    foodTag: 'alcohol',
    sentence: '한국지질동맥경화학회 2022 이상지질혈증 진료지침에서는 하루 1~2잔(1잔 당 약 10g 알코올) 이내로 제한하고, 가능하면 금주할 것을 권고하고 있습니다.',
    source: '질병관리청 국가건강정보포털 「이상지질혈증 식사요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'kidney-salty',
    reasonKind: 'condition',
    condition: 'kidney_disease',
    foodTag: 'salty',
    sentence: '염분 저류(염분이 몸 밖으로 배출되지 못하는 현상)에 의한 체액량 과다 및 고혈압은 그 자체로 콩팥 기능을 악화시킬 수 있기 때문에 철저한 저염 식이가 콩팥 기능의 악화를 늦추는데 도움이 됩니다. 소금 섭취를 하루 5 g 미만으로 제한하는 것을 권합니다.',
    source: '질병관리청 국가건강정보포털 「만성콩팥병」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'gout-alcohol',
    reasonKind: 'condition',
    condition: 'gout',
    foodTag: 'alcohol',
    sentence: '알코올은 신장에서의 요산 배설을 억제하고, 퓨린 합성과 요산 생성도 자극하여 고요산혈증을 악화시킵니다. 따라서 이미 통풍을 앓고 있는 환자라면 모든 종류의 알코올 섭취를 제한하는 것이 필요합니다.',
    source: '질병관리청 국가건강정보포털 「통풍」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'gout-sugary',
    reasonKind: 'condition',
    condition: 'gout',
    foodTag: 'sugary',
    sentence: '섭취를 줄여야 할 음식으로는 소고기, 양고기, 돼지고기 같은 붉은 육류, 정어리나 조개류 같은 퓨린 함량이 높은 해산물, 인공과당이 첨가되지 않은 자연 과일 주스, 설탕이나 소금이 많이 든 음식, 그리고 맥주를 포함한 알코올 음료 등이 있습니다.',
    source: '질병관리청 국가건강정보포털 「통풍」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'gout-salty',
    reasonKind: 'condition',
    condition: 'gout',
    foodTag: 'salty',
    sentence: '섭취를 줄여야 할 음식으로는 소고기, 양고기, 돼지고기 같은 붉은 육류, 정어리나 조개류 같은 퓨린 함량이 높은 해산물, 인공과당이 첨가되지 않은 자연 과일 주스, 설탕이나 소금이 많이 든 음식, 그리고 맥주를 포함한 알코올 음료 등이 있습니다.',
    source: '질병관리청 국가건강정보포털 「통풍」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'gout-fatty',
    reasonKind: 'condition',
    condition: 'gout',
    foodTag: 'fatty',
    sentence: '다만, 고지방·고칼로리 식습관은 개선해야 하며, 영양사의 도움을 받아 균형 잡힌 식단을 구성하는 것이 바람직합니다.',
    source: '질병관리청 국가건강정보포털 「통풍」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'heart-salty',
    reasonKind: 'condition',
    condition: 'heart_disease',
    foodTag: 'salty',
    sentence: '나트륨 섭취 줄이기(1일 5 g 미만으로 섭취)',
    source: '질병관리청 국가건강정보포털 「협심증」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'heart-fatty',
    reasonKind: 'condition',
    condition: 'heart_disease',
    foodTag: 'fatty',
    sentence: '건강한 식단 관리가 필요합니다. 통곡류와 야채류는 충분히 섭취하고, 고당분, 고칼로리 식단, 포화 지방, 트랜스 지방을 피합니다.',
    source: '질병관리청 국가건강정보포털 「협심증」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'heart-sugary',
    reasonKind: 'condition',
    condition: 'heart_disease',
    foodTag: 'sugary',
    sentence: '건강한 식단 관리가 필요합니다. 통곡류와 야채류는 충분히 섭취하고, 고당분, 고칼로리 식단, 포화 지방, 트랜스 지방을 피합니다.',
    source: '질병관리청 국가건강정보포털 「협심증」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'heart-alcohol',
    reasonKind: 'condition',
    condition: 'heart_disease',
    foodTag: 'alcohol',
    sentence: '음주를 절제하며, 가능하면 금주하는 게 좋습니다.',
    source: '질병관리청 국가건강정보포털 「협심증」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'warfarin-leafy-greens',
    reasonKind: 'medication',
    medicationClass: 'warfarin',
    foodTag: 'leafy_greens',
    sentence: '비타민 K는 혈액 응고에 큰 영향을 미칩니다. 와파린과 반대로 혈액 응고 작용을 항진시키므로, 와파린을 복용하는 환자는 규칙적으로 식사해 섭취하는 비타민 K의 양이 일정하게 하는 것이 좋습니다.',
    source: '질병관리청 국가건강정보포털 「항응고요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'warfarin-alcohol',
    reasonKind: 'medication',
    medicationClass: 'warfarin',
    foodTag: 'alcohol',
    sentence: '한의사가 항응고제 복용 사실을 알고 약물상호작용을 고려해 조제한 것 외의 모든 한약, 건강식품, 인삼(또는 홍삼), 녹즙, 술(알코올) 등은 와파린의 약효에 큰 영향을 줄 수 있으므로 피해야 합니다.',
    source: '질병관리청 국가건강정보포털 「항응고요법」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'ccb-grapefruit',
    reasonKind: 'medication',
    medicationClass: 'calcium_channel_blocker',
    foodTag: 'grapefruit',
    sentence: '고지혈증약(스타틴 제제), 면역 억제제, 혈압약의 일종인 칼슘 길항제, 수면제(예, 벤조다이아제핀계 약물) 등을 포함하여 80여 가지의 약은 자몽주스와 같이 먹을 경우 부작용이 일어날 확률이 높아집니다.',
    source: '질병관리청 국가건강정보포털 「노인 약물복용」',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
]

// AI에 "피할 음식"으로 보내지 않는 규칙. 화면의 식단 주의에는 그대로 나온다.
// warfarin-leafy-greens: 근거 문장이 "피하라"가 아니라 "비타민 K 양을 일정하게"다 (근거 노트 1-2).
// 식당 고르기에서 잎채소를 빼라고 하면 근거와 반대로 움직이게 된다.
const NOT_FOR_AI_AVOID = new Set(['warfarin-leafy-greens'])

// 서버가 AI에 넘길 피할 음식 태그를 계산할 때 쓰는 규칙 (avoidFoodTagsForTrip)
export const AI_AVOID_RULES: readonly DietRule[] = DIET_RULES.filter(rule => !NOT_FOR_AI_AVOID.has(rule.id))

// 확인 날짜는 'YYYY-MM' 또는 'YYYY-MM-DD' (SourceInfo와 같은 모양).
const CHECKED_AT_PATTERN = /^\d{4}-\d{2}(-\d{2})?$/

// 타입이 막아 주지 못하는 값(런타임에 만든 규칙, 빈 문자열)까지 보려고 unknown으로 받는다.
function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

// 규칙 표가 근거 없는 줄을 담고 있지 않은지 검사해, 문제를 한국어 문장 목록으로 돌려준다 (비어 있으면 문제 없음).
// 테스트가 DIET_RULES에 이 함수를 걸어 두어, 근거를 빼먹은 줄이나 신뢰 등급 C인 줄이 들어오면 바로 실패한다 (설계 4.4, 7장).
// 문제 문장에는 규칙 id만 쓴다. 병·약 같은 건강 정보는 이 표에 없으니 로그에 남겨도 안전하다.
export function validateDietRules(rules: readonly DietRule[]): string[] {
  const problems: string[] = []
  const seenIds = new Set<string>()

  for (const rule of rules) {
    const label = `규칙 "${rule.id}"`

    if (!DietRuleSchema.safeParse(rule).success) problems.push(`${label}: DietRuleSchema를 통과하지 못했어요`)

    if (seenIds.has(rule.id)) problems.push(`${label}: id가 겹쳐요`)
    seenIds.add(rule.id)

    // C(사진·후기로 추정)는 의학 주의의 근거로 쓰지 않는다.
    if (rule.confidence !== 'A' && rule.confidence !== 'B') problems.push(`${label}: 신뢰 등급은 A 또는 B만 쓸 수 있어요`)

    if (isBlank(rule.sentence)) problems.push(`${label}: 근거 문장이 비어 있어요`)
    // 샘플 문장이 근거인 척 남지 않게 한다.
    else if (rule.sentence.trimStart().startsWith('예시')) problems.push(`${label}: 근거 문장이 "예시"로 시작해요`)

    if (isBlank(rule.source)) problems.push(`${label}: 출처가 비어 있어요`)

    if (isBlank(rule.checkedAt)) problems.push(`${label}: 확인 날짜가 비어 있어요`)
    else if (!CHECKED_AT_PATTERN.test(rule.checkedAt)) problems.push(`${label}: 확인 날짜는 YYYY-MM 또는 YYYY-MM-DD 모양이어야 해요`)
  }
  return problems
}
