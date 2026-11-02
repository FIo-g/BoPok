// 건강 정보와 식단 주의. 주인: 김경선·김태형. 바꾸면 프론트와 함께 리뷰 (AGENTS.md 3장).
//
// 민감정보다 (설계 4.4·7장, 개인정보보호법 제23조). 이 파일의 타입을 쓰는 쪽이 지킬 것:
// - 약봉투 사진은 읽고 바로 버린다. 사진·원문은 이 타입 어디에도 두지 않는다 (약 "종류"만 저장).
// - 여행자 정보와 다른 테이블에 둔다. 따로 지우고, 따로 권한을 검사하고, 여행자 목록 API로 새지 않게 하려는 것이다.
// - 서버가 `canSeeHealth`로 보는 사람에 맞춰 걸러서 내려준다. 화면은 받은 것만으로 주의를 계산한다.
// - 로그에 건강 정보를 남기지 않는다.
import { z } from 'zod'
import { SourceInfoSchema } from './common'
import { FoodTagSchema } from './place'

// 고령층에 흔한 병. 최종 목록은 주의 규칙 표와 함께 [빌더]
export const HealthConditionSchema = z.enum([
  'diabetes',
  'hypertension',
  'dyslipidemia',
  'kidney_disease',
  'gout',
  'heart_disease',
])
export type HealthCondition = z.infer<typeof HealthConditionSchema>

// 약은 이름이 아니라 "종류"로 저장한다. 최종 목록은 주의 규칙 표와 함께 [빌더]
export const MedicationClassSchema = z.enum(['anticoagulant', 'calcium_channel_blocker'])
export type MedicationClass = z.infer<typeof MedicationClassSchema>

// group: 가족 모두에게 보임 / self: 본인에게만 보임
export const HealthVisibilitySchema = z.enum(['group', 'self'])
export type HealthVisibility = z.infer<typeof HealthVisibilitySchema>

// 저장 키는 (tripId, travelerId)다. travelerId는 여행 안에서만 유일하다 — 인터뷰가 t1, t2…로 만들고,
// trip_travelers의 기본키도 (trip_id, id)이다. travelerId만 키로 쓰면 다른 여행의 건강 정보와 섞인다.
export const TravelerHealthSchema = z.object({
  tripId: z.string().min(1),
  travelerId: z.string(),
  conditions: z.array(HealthConditionSchema),
  medicationClasses: z.array(MedicationClassSchema),
  visibility: HealthVisibilitySchema,
  consentAt: z.iso.datetime(), // 별도 동의를 받은 때 (설계 4.4)
  enteredByUserId: z.string(), // 대신 입력한 사람. 계정 없는 여행자의 "본인"이 된다
})
export type TravelerHealth = z.infer<typeof TravelerHealthSchema>

// 저장 요청 본문. 동의(consent: true)가 없으면 거부한다. 동의 날짜는 서버가 찍는다.
export const TravelerHealthInputSchema = z.object({
  conditions: z.array(HealthConditionSchema),
  medicationClasses: z.array(MedicationClassSchema),
  visibility: HealthVisibilitySchema,
  consent: z.literal(true),
})
export type TravelerHealthInput = z.infer<typeof TravelerHealthInputSchema>

// "본인만"이면 계정이 연결된 여행자가 우선이다 (대신 입력한 사람도 못 본다).
// 계정이 없는 여행자는 대신 입력한 사람만 본다. travelerUserId는 여행자에 연결된 계정(Traveler.userId)이고,
// 부르는 쪽은 `traveler.userId ?? null`을 넘긴다. 세 번째 인자를 꼭 받는 까닭: 생략(undefined)과
// "계정 없음"(null)을 같게 두면, 여행자를 못 찾아 값이 빠진 실수도 조용히 "대신 입력한 사람이 본인"으로 읽힌다.
// 'group'은 어떤 보는 사람이든 true다 — 그 사람이 이 그룹의 구성원인지는 API(route)가 먼저 검사한다.
export function canSeeHealth(
  health: Pick<TravelerHealth, 'visibility' | 'enteredByUserId'>,
  viewerUserId: string,
  travelerUserId: string | null,
): boolean {
  if (health.visibility === 'group') return true
  return viewerUserId === (travelerUserId ?? health.enteredByUserId)
}

// 사람이 만든 주의 규칙 표 한 줄: 병 또는 약 종류 → 주의할 음식 태그 → 근거 구절·출처·확인 날짜.
// 근거 없는 "괜찮아요"를 막으려고 SourceInfo의 선택 칸(source·checkedAt)을 필수로 바꾼다 (설계 7장).
const dietRuleBase = SourceInfoSchema.extend({
  id: z.string(),
  foodTag: FoodTagSchema,
  sentence: z.string().min(1), // 규칙 표의 근거 구절. AI는 이 문장만 쓴다
  source: z.string().min(1),
  checkedAt: z.string().min(1),
})

// 갈래마다 공통 칸을 extend로 붙인다. z.intersection보다 reasonKind로 타입이 깔끔하게 좁혀진다.
export const DietRuleSchema = z.discriminatedUnion('reasonKind', [
  dietRuleBase.extend({ reasonKind: z.literal('condition'), condition: HealthConditionSchema }),
  dietRuleBase.extend({ reasonKind: z.literal('medication'), medicationClass: MedicationClassSchema }),
])
export type DietRule = z.infer<typeof DietRuleSchema>

// 엔진이 돌려주는 주의 결과. 띄우되 막지 않는다 (설계 4.4).
// 서버는 주의 결과 "전체"를 canSeeHealth가 true인 사람에게만 내려준다. reason만 빼고 보내지 않는다 —
// 문장(sentence)·음식 태그·travelerId만으로도 누가 무슨 병인지 드러나기 때문이다.
export const DietCautionSchema = z.object({
  stopKey: z.string(),
  menuName: z.string().optional(),
  foodTag: FoodTagSchema,
  travelerId: z.string(),
  reasonKind: z.enum(['condition', 'medication']),
  reason: z.string(), // 화면에 보일 이유 (예: '당뇨'). 위 규칙대로 볼 수 있는 사람에게만 내려간다
  sentence: z.string().min(1),
  source: z.string().min(1),
  checkedAt: z.string().min(1),
})
export type DietCaution = z.infer<typeof DietCautionSchema>
