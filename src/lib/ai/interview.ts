// 인터뷰: 채워야 할 칸이 정해진 대화 (설계 6.3).
// 질문 문구·선택지는 코드가 정한다. AI는 자유 입력 답을 칸 값으로 바꿀 때만 쓴다.
// AI가 바꾸지 못하면 같은 질문을 "다시 여쭤볼게요. "를 붙여 다시 묻는다.
import 'server-only'
import { z } from 'zod'
import {
  CONDITION_QUESTIONS,
  UNKNOWN_CHOICE_LABEL,
  type ConditionQuestionId,
} from '@/lib/engine/condition'
import {
  InterviewRequestSchema,
  InterviewResponseSchema,
  TimeSchema,
  type InterviewAnswer,
  type InterviewFilled,
  type InterviewSlot,
  type InterviewState,
  type Pace,
  type StartMode,
  type Traveler,
} from '@/lib/contracts'
import type { ChatMessage } from './client'
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { handle, readJson } from './http'

type CallJsonOnly = Pick<AiDeps, 'callJson'>
type Cursor = InterviewState['cursor']

// AI·해석 실패 때 다음 질문 대신 붙이는 접두사
const RETRY_PREFIX = '다시 여쭤볼게요. '
// AI를 쓰지 않는 질문에서 글이 선택지와 다를 때 붙이는 접두사 — 아래 버튼에서 고르게 한다
const RETRY_CHOICE_PREFIX = '다시 여쭤볼게요. 아래에서 골라 주세요. '

// 함께 가는 사람 묶음. AI 입력에도 같은 묶음이 오면 나눈다
const TRAVELER_PRESETS = [
  { label: '엄마·아빠·나', labels: ['엄마', '아빠', '나'] },
  { label: '엄마·나', labels: ['엄마', '나'] },
  { label: '아빠·나', labels: ['아빠', '나'] },
] as const

// 이름표로 부모님 여부·성별을 정한다 (설계 6.3 인터뷰 진행) — 공백·앞말을 뗀 뒤 정확히 같을 때만
const FEMALE_PARENT_NAMES = ['엄마', '어머니', '어머님', '할머니', '외할머니', '친할머니', '장모님', '시어머니', '시어머님']
const MALE_PARENT_NAMES = ['아빠', '아버지', '아버님', '할아버지', '외할아버지', '친할아버지', '장인어른', '시아버지', '시아버님']

const RELATION_VALUES = ['mother', 'father', 'grandmother', 'grandfather', 'self', 'child', 'sibling', 'spouse', 'friend', 'other'] as const
type Relation = (typeof RELATION_VALUES)[number]

function stripSpaces(text: string): string {
  return text.replace(/\s+/g, '')
}

// 앞의 '우리'·'저희'·'내'와 공백을 뗀다 — '우리 엄마'는 '엄마'로 본다
function baseName(text: string): string {
  return stripSpaces(text).replace(/^(우리|저희|내)/, '')
}

// '님' 존칭을 기본형으로 — '시아버님'은 '시아버지'로, '어머님'은 '어머니'로 본다
function canonicalName(text: string): string {
  const base = baseName(text)
  const honor: Record<string, string> = {
    '어머님': '어머니',
    '아버님': '아버지',
    '시아버님': '시아버지',
    '시어머님': '시어머니',
    '할머님': '할머니',
    '할아버님': '할아버지',
  }
  if (honor[base] !== undefined) return honor[base]
  return base
}

function flagsFromLabel(label: string): { isParent: boolean; sex: 'female' | 'male' | undefined } {
  const norm = canonicalName(label)
  if (FEMALE_PARENT_NAMES.some(name => norm === stripSpaces(name))) return { isParent: true, sex: 'female' }
  if (MALE_PARENT_NAMES.some(name => norm === stripSpaces(name))) return { isParent: true, sex: 'male' }
  return { isParent: false, sex: undefined }
}

// AI 관계 값으로 부모님 여부·성별을 정한다 — mother·grandmother는 부모님·여성, father·grandfather는 부모님·남성
function flagsFromRelation(relation: Relation | undefined): { isParent: boolean; sex: 'female' | 'male' | undefined } | null {
  if (relation === undefined) return null
  if (relation === 'mother' || relation === 'grandmother') return { isParent: true, sex: 'female' }
  if (relation === 'father' || relation === 'grandfather') return { isParent: true, sex: 'male' }
  return { isParent: false, sex: undefined }
}

// 말하는 본인 이름표 — 인터뷰로 채워도 본인이 직접 답한 것으로 본다 (설계 7.1.3)
function isSelfLabel(label: string): boolean {
  const norm = stripSpaces(label)
  return norm === '나' || norm === '본인' || norm === '저'
}

function newTraveler(id: string, label: string, relation?: Relation): Traveler {
  const byRelation = flagsFromRelation(relation)
  const byLabel = flagsFromLabel(label)
  // 둘 중 하나라도 부모님이면 부모님으로 본다 (안전한 쪽). 성별은 이름표가 우선이다
  const isParent = (byRelation?.isParent ?? false) || byLabel.isParent
  const sex = byLabel.sex ?? byRelation?.sex
  return {
    id,
    label,
    ...(sex === undefined ? {} : { sex }),
    pace: 'unknown',
    mobilityAid: false,
    isParent,
    condition: {},
    // 인터뷰는 여행 만든 사람이 대신 답한 것 — 본인 이름표만 true (설계 7.1.3)
    filledBySelf: isSelfLabel(label),
  }
}

// 이미 있는 여행자도 부모님인데 성별이 비면 이름표로 채운다
function fillSexFromLabel(traveler: Traveler): void {
  if (!traveler.isParent || traveler.sex !== undefined) return
  const { sex } = flagsFromLabel(traveler.label)
  if (sex !== undefined) traveler.sex = sex
}

// 마지막 글자에 받침이 있으면 '은', 없으면 '는' — 질문 문구의 은/는용
function particle(label: string): string {
  const last = label.trim().slice(-1)
  if (!last) return '은(는)'
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return '은(는)'
  return (code - 0xac00) % 28 === 0 ? '는' : '은'
}

// 부모님은 50대부터, 그 밖은 10대부터 (설계 6.3 나이 구간)
const PARENT_AGES = [
  { label: '50대', age: 55 },
  { label: '60대', age: 65 },
  { label: '70대', age: 75 },
  { label: '80대 이상', age: 82 },
]
const OTHER_AGES = [
  { label: '10대', age: 15 },
  { label: '20대', age: 25 },
  { label: '30대', age: 35 },
  { label: '40대', age: 45 },
  { label: '50대 이상', age: 55 },
]

const HEIGHTS = [
  { label: '150cm 안팎', cm: 150 },
  { label: '160cm 안팎', cm: 160 },
  { label: '170cm 안팎', cm: 170 },
  { label: '180cm 안팎', cm: 180 },
]

const SEX_CHOICES = [
  { label: '여성', sex: 'female' as const },
  { label: '남성', sex: 'male' as const },
]

const PARENT_GATE_CHOICES = ['지금 대신 답할게요', '부모님께 직접 받을게요']
const OTHER_GATE_CHOICES = ['없어요', '있어요']

const TIME_CHOICES = [
  { label: '아침 9시 ~ 저녁 6시', startTime: '09:00', endTime: '18:00' },
  { label: '오전 10시 ~ 오후 5시', startTime: '10:00', endTime: '17:00' },
  { label: '오후 1시 ~ 저녁 7시', startTime: '13:00', endTime: '19:00' },
]

const TRANSPORT_CHOICES = [
  { label: '자가용', value: 'car' as const },
  { label: '대중교통', value: 'transit' as const },
  { label: '택시', value: 'taxi' as const },
]

// 설계 6.3의 여행 스타일 10가지 — '기타'는 직접 입력 그대로 둔다
const STYLE_CHOICES = [
  '관광·명소',
  '레저·체험',
  '휴식·힐링',
  '자연·산책',
  '맛집·음식',
  '문화·역사',
  '과학·전시',
  '온천·스파',
  '사진 명소',
  '쇼핑',
]

const BUDGET_CHOICES = [
  { label: '3만 원까지', value: 'under_30k' as const },
  { label: '3~5만 원', value: '30k_50k' as const },
  { label: '5~10만 원', value: '50k_100k' as const },
  { label: '10만 원 이상', value: 'over_100k' as const },
]

const FIX_TARGET_CHOICES = ['전체적으로 덜 걷게', '계단을 피하게', '쉬는 곳을 넣게']
const DATE_CHOICES = ['이번 주말', '다음 주말']

// AI가 돌려줄 모양. 걷는 시간·거리 칸은 두지 않는다
const TravelersAiSchema = z.object({
  travelers: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        relation: z.enum(RELATION_VALUES).optional(),
      }),
    )
    .min(1)
    .max(8),
})
const AgeAiSchema = z.object({ age: z.number().int().min(0).max(120).nullable() })
const DateAiSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
const TimeAiSchema = z.object({ startTime: TimeSchema.nullable(), endTime: TimeSchema.nullable() })
const MustVisitAiSchema = z.object({
  mustVisit: z.array(z.object({ name: z.string().trim().min(1), reservedAt: TimeSchema.optional() })),
})

const TRAVELERS_SYSTEM =
  "'부모님'은 엄마와 아빠 두 명으로 나눠라. 말하는 본인은 '나'로 넣어라. " +
  '함께 가는 사람을 이름표와 관계 값 목록(mother, father, grandmother, grandfather, self, child, sibling, spouse, friend, other)으로 바꿔라. ' +
  '시어머니·장모님은 mother, 시아버지·장인어른은 father로 넣어라. ' +
  '반드시 JSON으로만 답하라. 모양: {"travelers":[{"label":"엄마","relation":"mother"}]}'
const AGE_SYSTEM =
  '나이 답을 0~120 사이 숫자로 바꿔라. 알 수 없으면 null. 반드시 JSON으로만 답하라. 모양: {"age":72}'
const TIME_SYSTEM =
  '출발·귀가 시간을 HH:mm으로 바꿔라. 반드시 JSON으로만 답하라. 모양: {"startTime":"09:00","endTime":"18:00"}'
const MUST_VISIT_SYSTEM =
  '꼭 가고 싶은 곳과 예약 시간을 뽑아라. 없으면 빈 배열. 반드시 JSON으로만 답하라. 모양: {"mustVisit":[{"name":"장소","reservedAt":"HH:mm"}]}'

// 서울 기준 오늘 YYYY-MM-DD — Intl로 서울 날짜를 구한다
function seoulYmd(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function seoulYear(now: Date): number {
  return Number(seoulYmd(now).slice(0, 4))
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

function seoulWeekdayKo(now: Date): string {
  const ymd = seoulYmd(now)
  const [year, month, day] = ymd.split('-').map(Number)
  return WEEKDAY_KO[new Date(year!, month! - 1, day!).getDay()]!
}

function dateSystem(now: Date): string {
  const ymd = seoulYmd(now)
  const weekday = seoulWeekdayKo(now)
  return (
    `오늘은 ${ymd}(${weekday})이다. 여행 날짜를 YYYY-MM-DD로 바꿔라. 이미 지난 날짜면 다음 해로 해라. ` +
    '반드시 JSON으로만 답하라. 모양: {"date":"YYYY-MM-DD"}'
  )
}

// AI 실패는 null로 — 부른 쪽에서 같은 질문을 다시 묻는다. AiCallError가 아니면 다시 던진다
async function askAi<T>(deps: CallJsonOnly, messages: ChatMessage[], schema: z.ZodType<T>): Promise<T | null> {
  try {
    return await deps.callJson({ messages, schema, temperature: 0 })
  } catch (error) {
    if (error instanceof AiCallError) return null
    throw error
  }
}

export function questionIdFor(cursor: Cursor): string {
  return `${cursor.slot}:${cursor.travelerIndex}:${cursor.questionIndex}`
}

export function initialState(mode: StartMode, travelers: Traveler[]): InterviewState {
  const copied = travelers.map(t => ({ ...t, condition: { ...t.condition } }))
  return {
    filled: {
      mode,
      travelers: copied,
      styles: [],
      mustVisit: [],
      fixTargets: [],
    },
    // 여행자가 이미 있으면 함께 가는 사람 질문을 건너뛴다
    cursor:
      copied.length > 0
        ? { slot: 'traveler_age', travelerIndex: 0, questionIndex: 0 }
        : { slot: 'travelers', travelerIndex: 0, questionIndex: 0 },
    history: [],
  }
}

export function currentQuestion(state: InterviewState): { slot: InterviewSlot; text: string; choices: string[] } {
  const { slot, travelerIndex, questionIndex } = state.cursor
  const traveler = state.filled.travelers[travelerIndex]
  const label = traveler?.label ?? '함께 가시는 분'
  switch (slot) {
    case 'travelers':
      return { slot, text: '함께 가시는 분을 알려 주세요.', choices: TRAVELER_PRESETS.map(p => p.label) }
    case 'traveler_age': {
      // 부모님이 아니면 '나이'로 묻는다 — 받침에 따라 은/는을 붙인다
      const ages = traveler && !traveler.isParent ? OTHER_AGES : PARENT_AGES
      const noun = traveler && !traveler.isParent ? '나이가 어떻게 되세요?' : '연세가 어떻게 되세요?'
      return {
        slot,
        text: `${label}${particle(label)} ${noun}`,
        choices: [...ages.map(a => a.label), UNKNOWN_CHOICE_LABEL],
      }
    }
    case 'traveler_height':
      return {
        slot,
        text: `${label}의 키는 대략 어느 정도인가요?`,
        choices: [...HEIGHTS.map(h => h.label), UNKNOWN_CHOICE_LABEL],
      }
    case 'traveler_sex':
      // 이름표로 정해지지 않을 때만 묻는다 — 문구는 코드가 정한다
      return { slot, text: `${label}의 성별을 알려 주세요.`, choices: [...SEX_CHOICES.map(c => c.label), UNKNOWN_CHOICE_LABEL] }
    case 'traveler_condition_gate':
      if (traveler?.isParent) {
        return { slot, text: `${label}의 걷기 조건을 여쭤볼게요.`, choices: [...PARENT_GATE_CHOICES] }
      }
      return { slot, text: `${label}도 걷기에 불편한 점이 있으세요?`, choices: [...OTHER_GATE_CHOICES] }
    case 'traveler_condition': {
      const question = CONDITION_QUESTIONS[questionIndex] ?? CONDITION_QUESTIONS[0]!
      return {
        slot,
        text: question.title,
        choices: [
          ...question.choices.map(c => c.label),
          ...(question.allowUnknown ? [UNKNOWN_CHOICE_LABEL] : []),
        ],
      }
    }
    case 'date':
      return { slot, text: '언제 가세요?', choices: [...DATE_CHOICES] }
    case 'time':
      return { slot, text: '몇 시쯤 출발해서 몇 시쯤 돌아오실까요?', choices: TIME_CHOICES.map(c => c.label) }
    case 'transport':
      return { slot, text: '어떻게 이동하실 거예요?', choices: TRANSPORT_CHOICES.map(c => c.label) }
    case 'styles':
      return { slot, text: '어떤 여행을 좋아하세요? 여러 개 골라도 돼요.', choices: [...STYLE_CHOICES] }
    case 'budget':
      return { slot, text: '한 사람당 하루 예산은요?', choices: BUDGET_CHOICES.map(c => c.label) }
    case 'must_visit':
      return { slot, text: '꼭 가고 싶은 곳이나 예약해 둔 곳이 있나요?', choices: ['없어요'] }
    case 'fix_target':
      return { slot, text: '붙여 넣은 일정에서 어디를 고치고 싶으세요?', choices: [...FIX_TARGET_CHOICES] }
    case 'done':
      return { slot, text: '다 됐어요. 이제 일정을 짜 볼게요.', choices: [] }
  }
}

// 공백을 뺀 글이 선택지 label과 정확히 같을 때만 고른다 — 부분 일치는 없다
function textToChoice(text: string, choices: readonly string[]): number | null {
  const t = stripSpaces(text)
  const exact = choices.findIndex(c => stripSpaces(c) === t)
  return exact >= 0 ? exact : null
}

function toDateString(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number)
  return toDateString(new Date(year!, month! - 1, day! + days))
}

// 이번 주말·다음 주말은 서울 기준. 토요일이면 그날, 일요일이면 그날, 그 밖은 다가오는 토요일
function weekendDates(now: Date): [string, string] {
  const ymd = seoulYmd(now)
  const [year, month, day] = ymd.split('-').map(Number)
  const base = new Date(year!, month! - 1, day!)
  const weekday = base.getDay()
  let thisWeekend: Date
  if (weekday === 6 || weekday === 0) {
    thisWeekend = base
  } else {
    thisWeekend = new Date(year!, month! - 1, day! + ((6 - weekday + 7) % 7))
  }
  const nextWeekend = new Date(thisWeekend.getFullYear(), thisWeekend.getMonth(), thisWeekend.getDate() + 7)
  return [toDateString(thisWeekend), toDateString(nextWeekend)]
}

// YYYY-MM-DD가 실제 날짜인지 — AI가 엉뚱한 월·일을 내놓으면 다시 묻는다
function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month! < 1 || month! > 12) return false
  const date = new Date(year!, month! - 1, day!)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day
}

// conditionFromAnswers와 같은 규칙을 한 문항씩 적용한다 — 모르면 칸을 비운다
function applyConditionValue(traveler: Traveler, id: ConditionQuestionId, value: number | boolean | Pace): void {
  switch (id) {
    case 'continuousMin':
    case 'dayMin':
    case 'restMin':
      if (typeof value === 'number') traveler.condition[id] = value
      return
    case 'avoidStairs':
      if (typeof value === 'boolean') traveler.condition.avoidStairs = value
      return
    case 'pace':
      traveler.pace = value === 'slow' || value === 'normal' ? value : 'unknown'
      return
    case 'mobilityAid':
      if (typeof value === 'boolean') traveler.mobilityAid = value
  }
}

function clearConditionValue(traveler: Traveler, id: ConditionQuestionId): void {
  switch (id) {
    case 'continuousMin':
    case 'dayMin':
    case 'restMin':
    case 'avoidStairs':
      delete traveler.condition[id]
      return
    case 'pace':
      // '잘 모르겠어요'는 나이 기준 값 — 비움 표시가 'unknown'이다
      traveler.pace = 'unknown'
      return
    case 'mobilityAid':
      // 보조기구는 사실이라 '잘 모르겠어요'가 없다 — 그대로 둔다
      return
  }
}

// 조건을 통째로 비운다 — 직접 받기·불편 없음일 때 이미 있던 값도 지운다
function clearTravelerCondition(traveler: Traveler): void {
  traveler.condition = {}
  traveler.pace = 'unknown'
  traveler.mobilityAid = false
}

// 이 여행자를 마치고 다음 여행자 나이로, 다 끝났으면 날짜로
function afterTraveler(filled: InterviewFilled, travelerIndex: number): Cursor {
  if (travelerIndex + 1 < filled.travelers.length) {
    return { slot: 'traveler_age', travelerIndex: travelerIndex + 1, questionIndex: 0 }
  }
  return { slot: 'date', travelerIndex: 0, questionIndex: 0 }
}

// 공백·마침표를 뺀 전체가 '없어요' 계열일 때만 빈 목록
function isEmptyMustVisitText(text: string): boolean {
  const norm = text.replace(/[\s.。]/g, '')
  return norm === '없어요' || norm === '없음' || norm === '없다' || norm === '없습니다' || norm === '없어'
}

function markFilledBySelf(traveler: Traveler): void {
  traveler.filledBySelf = isSelfLabel(traveler.label)
}

export async function applyAnswer(
  state: InterviewState,
  answer: InterviewAnswer,
  deps: CallJsonOnly,
  now: Date = new Date(),
): Promise<{ state: InterviewState; retryText?: string }> {
  const question = currentQuestion(state)
  // 범위 밖 선택은 400이 아니라 같은 질문 다시
  if (answer.choiceIndex !== undefined && answer.choiceIndex >= question.choices.length) {
    return { state }
  }
  const retry = { state, retryText: RETRY_PREFIX }
  const retryChoice = { state, retryText: RETRY_CHOICE_PREFIX }

  // filled를 직접 고치지 않고 복사본에 적는다
  const filled: InterviewFilled = {
    ...state.filled,
    travelers: state.filled.travelers.map(t => ({ ...t, condition: { ...t.condition } })),
    styles: [...state.filled.styles],
    mustVisit: state.filled.mustVisit.map(m => ({ ...m })),
    fixTargets: [...state.filled.fixTargets],
  }
  const next = (cursor: Cursor): { state: InterviewState } => ({ state: { ...state, filled, cursor } })
  const traveler = filled.travelers[state.cursor.travelerIndex]
  const { slot } = state.cursor

  switch (slot) {
    case 'travelers': {
      let entries: { label: string; relation?: Relation }[] | null = null
      if (answer.choiceIndex !== undefined) {
        entries = TRAVELER_PRESETS[answer.choiceIndex]!.labels.map(label => ({ label }))
      } else if (answer.text !== undefined) {
        const preset = TRAVELER_PRESETS.find(p => canonicalName(p.label) === canonicalName(answer.text!))
        if (preset) {
          entries = preset.labels.map(label => ({ label }))
        } else {
          const parsed = await askAi(
            deps,
            [
              { role: 'system', content: TRAVELERS_SYSTEM },
              { role: 'user', content: answer.text },
            ],
            TravelersAiSchema,
          )
          const list = parsed?.travelers.map(t => ({ label: t.label.trim(), relation: t.relation })).filter(entry => entry.label.length > 0) ?? []
          if (list.length === 0) return retry
          entries = list
        }
      } else {
        return { state }
      }
      filled.travelers = entries.map((entry, i) => newTraveler(`t${i + 1}`, entry.label, entry.relation))
      return next({ slot: 'traveler_age', travelerIndex: 0, questionIndex: 0 })
    }

    case 'traveler_age': {
      if (!traveler) return { state }
      fillSexFromLabel(traveler)
      const ages = traveler.isParent ? PARENT_AGES : OTHER_AGES
      if (answer.choiceIndex !== undefined) {
        if (answer.choiceIndex < ages.length) traveler.age = ages[answer.choiceIndex]!.age
        else delete traveler.age
      } else if (answer.text !== undefined) {
        const picked = textToChoice(answer.text, [...ages.map(a => a.label), UNKNOWN_CHOICE_LABEL])
        if (picked !== null) {
          if (picked < ages.length) traveler.age = ages[picked]!.age
          else delete traveler.age
        } else if (/몰라|모르/.test(answer.text)) {
          // '몰라'·'모르'·'잘 모르' → 모름 (나이 비움)
          delete traveler.age
        } else {
          const yearMatch = /(\d{4})/.exec(answer.text)
          const year = yearMatch ? Number(yearMatch[1]) : NaN
          const today = seoulYear(now)
          if (yearMatch && Number.isInteger(year) && year >= 1900 && year <= today) {
            // 4자리 연도는 서울 기준 올해에서 뺀다 ('1950년생' → 76)
            traveler.age = today - year
          } else {
            const stripped = stripSpaces(answer.text)
            // 숫자 하나만(72·72세) 바로 받고, 말이 섞이면 AI로 묻는다
            if (/^\d{1,3}(세|살)?$/.test(stripped)) {
              const n = Number(stripped.replace(/(세|살)$/, ''))
              if (Number.isInteger(n) && n >= 0 && n <= 120) {
                traveler.age = n
              } else {
                const parsed = await askAi(
                  deps,
                  [
                    { role: 'system', content: AGE_SYSTEM },
                    { role: 'user', content: answer.text },
                  ],
                  AgeAiSchema,
                )
                if (!parsed || parsed.age === null) return retry
                traveler.age = parsed.age
              }
            } else {
              const parsed = await askAi(
                deps,
                [
                  { role: 'system', content: AGE_SYSTEM },
                  { role: 'user', content: answer.text },
                ],
                AgeAiSchema,
              )
              if (!parsed || parsed.age === null) return retry
              traveler.age = parsed.age
            }
          }
        }
      } else {
        return { state }
      }
      markFilledBySelf(traveler)
      return next({ slot: 'traveler_height', travelerIndex: state.cursor.travelerIndex, questionIndex: 0 })
    }

    case 'traveler_height': {
      if (!traveler) return { state }
      fillSexFromLabel(traveler)
      if (answer.choiceIndex !== undefined) {
        if (answer.choiceIndex < HEIGHTS.length) traveler.heightCm = HEIGHTS[answer.choiceIndex]!.cm
        else delete traveler.heightCm
      } else if (answer.text !== undefined) {
        const picked = textToChoice(answer.text, [...HEIGHTS.map(h => h.label), UNKNOWN_CHOICE_LABEL])
        if (picked !== null) {
          if (picked < HEIGHTS.length) traveler.heightCm = HEIGHTS[picked]!.cm
          else delete traveler.heightCm
        } else {
          const norm = stripSpaces(answer.text).toLowerCase()
          if (norm.includes('m')) {
            // '1m70'·'1.7m' 같은 미터 표기는 cm로 바꾼다
            const meterMatch = /(\d+(?:\.\d+)?)m(\d{1,2})?/.exec(norm)
            if (!meterMatch) return retryChoice
            const whole = Number(meterMatch[1])
            const rest = meterMatch[2]
            // 소수점이 있으면 미터 환산, 정수+m+숫자면 m와 cm를 더한다
            const useCm =
              rest === undefined || !Number.isInteger(whole)
                ? Math.round(whole * 100)
                : Math.round(whole) * 100 + (rest.length === 1 ? Number(rest) * 10 : Number(rest))
            if (!Number.isFinite(useCm) || useCm < 50 || useCm > 250) return retryChoice
            traveler.heightCm = useCm
          } else {
            const digits = /(\d{2,3})/.exec(answer.text)
            const n = digits ? Number(digits[1]) : NaN
            // 그 밖 숫자 2~3자리는 cm로 본다. 범위 밖이면 다시 묻는다
            if (!digits || !Number.isInteger(n) || n < 50 || n > 250) return retryChoice
            // 숫자가 하나가 아니면(둘 이상) 엉뚱한 입력으로 보고 다시 묻는다
            const all = answer.text.match(/\d+/g) ?? []
            if (all.length !== 1) return retryChoice
            traveler.heightCm = n
          }
        }
      } else {
        return { state }
      }
      markFilledBySelf(traveler)
      // 이름표로 성별이 정해졌으면 묻지 않는다
      const travelerIndex = state.cursor.travelerIndex
      return next(
        traveler.sex !== undefined
          ? { slot: 'traveler_condition_gate', travelerIndex, questionIndex: 0 }
          : { slot: 'traveler_sex', travelerIndex, questionIndex: 0 },
      )
    }

    case 'traveler_sex': {
      if (!traveler) return { state }
      fillSexFromLabel(traveler)
      // 이름표로 이미 정해졌으면 묻지 않고 넘어간다
      if (traveler.sex !== undefined) {
        return next({ slot: 'traveler_condition_gate', travelerIndex: state.cursor.travelerIndex, questionIndex: 0 })
      }
      const labels = [...SEX_CHOICES.map(c => c.label), UNKNOWN_CHOICE_LABEL]
      const picked = answer.choiceIndex !== undefined ? answer.choiceIndex : answer.text !== undefined ? textToChoice(answer.text, labels) : null
      if (picked === null || picked >= labels.length) return retryChoice
      if (picked < SEX_CHOICES.length) traveler.sex = SEX_CHOICES[picked]!.sex
      else delete traveler.sex
      markFilledBySelf(traveler)
      return next({ slot: 'traveler_condition_gate', travelerIndex: state.cursor.travelerIndex, questionIndex: 0 })
    }

    case 'traveler_condition_gate': {
      if (!traveler) return { state }
      fillSexFromLabel(traveler)
      const choices = traveler.isParent ? PARENT_GATE_CHOICES : OTHER_GATE_CHOICES
      const picked =
        answer.choiceIndex !== undefined
          ? answer.choiceIndex
          : answer.text !== undefined
            ? textToChoice(answer.text, choices)
            : null
      if (picked === null || picked >= choices.length) return retryChoice
      // 직접 받기(부모님)나 불편 없음(그 밖)은 조건을 비우고 건너뛴다 — 있던 값도 지운다
      const asksCondition = traveler.isParent ? picked === 0 : picked === 1
      if (!asksCondition) {
        clearTravelerCondition(traveler)
        markFilledBySelf(traveler)
        if (traveler.isParent) {
          // 7.1.3 확인 카드로 이어지도록 본인이 채우지 않았음을 남긴다
          traveler.filledBySelf = false
        }
        return next(afterTraveler(filled, state.cursor.travelerIndex))
      }
      markFilledBySelf(traveler)
      return next({ slot: 'traveler_condition', travelerIndex: state.cursor.travelerIndex, questionIndex: 0 })
    }

    case 'traveler_condition': {
      if (!traveler) return { state }
      const travelerIndex = state.cursor.travelerIndex
      const questionIndex = state.cursor.questionIndex
      const conditionQuestion = CONDITION_QUESTIONS[questionIndex]
      if (!conditionQuestion) return next(afterTraveler(filled, travelerIndex))
      const labels = [
        ...conditionQuestion.choices.map(c => c.label),
        ...(conditionQuestion.allowUnknown ? [UNKNOWN_CHOICE_LABEL] : []),
      ]
      const picked =
        answer.choiceIndex !== undefined
          ? answer.choiceIndex
          : answer.text !== undefined
            ? textToChoice(answer.text, labels)
            : null
      // 부분 일치 없이 정확히 같을 때만 받는다 ('안 괜찮아요'·'아니네요'는 다시 묻기)
      if (picked === null || picked >= labels.length) return retryChoice
      if (picked < conditionQuestion.choices.length) {
        applyConditionValue(traveler, conditionQuestion.id, conditionQuestion.choices[picked]!.value)
      } else {
        clearConditionValue(traveler, conditionQuestion.id)
      }
      markFilledBySelf(traveler)
      if (questionIndex + 1 < CONDITION_QUESTIONS.length) {
        return next({ slot: 'traveler_condition', travelerIndex, questionIndex: questionIndex + 1 })
      }
      return next(afterTraveler(filled, travelerIndex))
    }

    case 'date': {
      if (answer.choiceIndex !== undefined) {
        const [thisSaturday, nextSaturday] = weekendDates(now)
        filled.date = answer.choiceIndex === 0 ? thisSaturday : nextSaturday
      } else if (answer.text !== undefined) {
        const picked = textToChoice(answer.text, DATE_CHOICES)
        if (picked !== null) {
          const [thisSaturday, nextSaturday] = weekendDates(now)
          filled.date = picked === 0 ? thisSaturday : nextSaturday
        } else {
          const parsed = await askAi(
            deps,
            [
              { role: 'system', content: dateSystem(now) },
              { role: 'user', content: answer.text },
            ],
            DateAiSchema,
          )
          if (!parsed || !isRealDate(parsed.date)) return retry
          const today = seoulYmd(now)
          const limit = addDaysYmd(today, 366)
          let date = parsed.date
          if (date < today) {
            // AI가 준 날짜가 오늘보다 앞이면 연도 +1
            const [year, month, day] = date.split('-').map(Number)
            const bumped = `${year! + 1}-${String(month!).padStart(2, '0')}-${String(day!).padStart(2, '0')}`
            if (!isRealDate(bumped) || bumped < today || bumped > limit) return retry
            date = bumped
          } else if (date > limit) {
            // 오늘부터 366일 밖이면 다시 묻는다
            return retry
          }
          filled.date = date
        }
      } else {
        return { state }
      }
      return next({ slot: 'time', travelerIndex: 0, questionIndex: 0 })
    }

    case 'time': {
      if (answer.choiceIndex !== undefined) {
        const picked = TIME_CHOICES[answer.choiceIndex]!
        filled.startTime = picked.startTime
        filled.endTime = picked.endTime
      } else if (answer.text !== undefined) {
        const picked = textToChoice(answer.text, TIME_CHOICES.map(c => c.label))
        if (picked !== null) {
          filled.startTime = TIME_CHOICES[picked]!.startTime
          filled.endTime = TIME_CHOICES[picked]!.endTime
        } else {
          const parsed = await askAi(
            deps,
            [
              { role: 'system', content: TIME_SYSTEM },
              { role: 'user', content: answer.text },
            ],
            TimeAiSchema,
          )
          // 둘 다 있고 시작이 끝보다 빠를 때만 받는다
          if (!parsed || !parsed.startTime || !parsed.endTime || !(parsed.startTime < parsed.endTime)) return retry
          filled.startTime = parsed.startTime
          filled.endTime = parsed.endTime
        }
      } else {
        return { state }
      }
      return next({ slot: 'transport', travelerIndex: 0, questionIndex: 0 })
    }

    case 'transport': {
      const picked =
        answer.choiceIndex !== undefined
          ? answer.choiceIndex
          : answer.text !== undefined
            ? textToChoice(answer.text, TRANSPORT_CHOICES.map(c => c.label))
            : null
      if (picked === null || picked >= TRANSPORT_CHOICES.length) return retryChoice
      filled.transport = TRANSPORT_CHOICES[picked]!.value
      // 대중교통 비교(7.3.1)는 이동수단 고르기에만 쓴다 — 여기서는 값만 둔다
      return next({
        slot: filled.mode === 'scratch' ? 'styles' : 'must_visit',
        travelerIndex: 0,
        questionIndex: 0,
      })
    }

    case 'styles': {
      if (answer.choiceIndex !== undefined) {
        filled.styles = [STYLE_CHOICES[answer.choiceIndex]!]
      } else if (answer.text !== undefined) {
        // 여러 개는 쉼표(`,`, `、`, `，`)로 나눈다. '기타'는 직접 입력 그대로
        const picked = answer.text
          .split(/[,、，]/)
          .map(s => s.trim().slice(0, 30))
          .filter(s => s.length > 0)
          .filter((s, i, all) => all.indexOf(s) === i)
          .slice(0, 10)
        if (picked.length === 0) return retry
        filled.styles = picked
      } else {
        return { state }
      }
      return next({ slot: 'budget', travelerIndex: 0, questionIndex: 0 })
    }

    case 'budget': {
      const picked =
        answer.choiceIndex !== undefined
          ? answer.choiceIndex
          : answer.text !== undefined
            ? textToChoice(answer.text, BUDGET_CHOICES.map(c => c.label))
            : null
      if (picked === null || picked >= BUDGET_CHOICES.length) return retryChoice
      filled.budget = BUDGET_CHOICES[picked]!.value
      return next({ slot: 'must_visit', travelerIndex: 0, questionIndex: 0 })
    }

    case 'must_visit': {
      if (answer.choiceIndex !== undefined) {
        filled.mustVisit = []
      } else if (answer.text !== undefined) {
        if (isEmptyMustVisitText(answer.text)) {
          filled.mustVisit = []
        } else {
          const parsed = await askAi(
            deps,
            [
              { role: 'system', content: MUST_VISIT_SYSTEM },
              { role: 'user', content: answer.text },
            ],
            MustVisitAiSchema,
          )
          if (!parsed || parsed.mustVisit.length === 0) return retry
          filled.mustVisit = parsed.mustVisit
        }
      } else {
        return { state }
      }
      return next({
        slot: filled.mode === 'paste' ? 'fix_target' : 'done',
        travelerIndex: 0,
        questionIndex: 0,
      })
    }

    case 'fix_target': {
      if (answer.choiceIndex !== undefined) {
        filled.fixTargets = [FIX_TARGET_CHOICES[answer.choiceIndex]!]
      } else if (answer.text !== undefined) {
        if (answer.text.trim().length === 0) return retry
        filled.fixTargets = [answer.text.trim()]
      } else {
        return { state }
      }
      return next({ slot: 'done', travelerIndex: 0, questionIndex: 0 })
    }

    case 'done':
      return { state }
  }
}

function toInterviewResponse(state: InterviewState, question: { slot: InterviewSlot; text: string; choices: string[] }) {
  return InterviewResponseSchema.parse({
    text: question.text,
    choices: question.choices,
    slot: question.slot,
    done: question.slot === 'done',
    filled: state.filled,
    questionId: questionIdFor(state.cursor),
  })
}

export async function handleInterview(
  request: Request,
  deps: AiDeps,
  opts?: { now?: () => number },
): Promise<Response> {
  return handle(async () => {
    const nowFn = opts?.now ?? Date.now
    const deadlineAt = nowFn() + 25000
    // 요청 예산 안에서 AI 호출을 나눠 쓴다.
    const budgeted: AiDeps = {
      ...deps,
      callJson: ((req: Parameters<AiDeps['callJson']>[0], extra?: Parameters<AiDeps['callJson']>[1]) =>
        deps.callJson(req, { ...extra, deadlineMs: Math.max(1, deadlineAt - nowFn()) })) as AiDeps['callJson'],
    }
    const input = await readJson(request, InterviewRequestSchema)
    await deps.requireTripMember(request, input.tripId)
    let state = await deps.interviews.get(input.tripId)
    if (!state) {
      // 처음이면 여행자·모드로 시작하고 답은 무시한다 — getTripContext는 상태가 없을 때만 부른다
      const context = await deps.getTripContext(input.tripId)
      state = initialState(context.trip.startMode, context.travelers)
      const question = currentQuestion(state)
      state = { ...state, history: [{ role: 'assistant', text: question.text }] }
      await deps.interviews.save(input.tripId, state)
      return toInterviewResponse(state, question)
    }
    // done 뒤에는 답을 무시하고 상태를 바꾸지 않고 done 응답만 돌려준다
    if (state.cursor.slot === 'done') {
      return toInterviewResponse(state, currentQuestion(state))
    }
    if (input.answer) {
      const question = currentQuestion(state)
      // questionId가 있고 지금 질문과 다르면 범위 검사·적용보다 먼저 지금 질문을 그대로 돌려준다
      if (input.questionId !== undefined && input.questionId !== questionIdFor(state.cursor)) {
        return toInterviewResponse(state, question)
      }
      // 범위 밖 선택은 400이 아니라 같은 질문 다시
      if (input.answer.choiceIndex !== undefined && input.answer.choiceIndex >= question.choices.length) {
        return toInterviewResponse(state, question)
      }
      const userText =
        input.answer.choiceIndex !== undefined ? question.choices[input.answer.choiceIndex]! : (input.answer.text ?? '')
      const applied = await applyAnswer(state, input.answer, budgeted)
      if (applied.retryText) {
        const text = `${applied.retryText}${question.text}`
        const retryState: InterviewState = {
          ...applied.state,
          history: [
            ...applied.state.history,
            { role: 'user', text: userText },
            { role: 'assistant', text },
          ],
        }
        await deps.interviews.save(input.tripId, retryState)
        return toInterviewResponse(retryState, { ...question, text })
      }
      const nextQuestion = currentQuestion(applied.state)
      const nextState: InterviewState = {
        ...applied.state,
        history: [
          ...applied.state.history,
          { role: 'user', text: userText },
          { role: 'assistant', text: nextQuestion.text },
        ],
      }
      if (nextQuestion.slot === 'done') {
        // done에 닿으면 여행자 저장 먼저 — 성공하면 done 상태 저장, 실패면 저장하지 않는다
        await deps.saveTravelers(input.tripId, nextState.filled.travelers)
        await deps.interviews.save(input.tripId, nextState)
      } else {
        await deps.interviews.save(input.tripId, nextState)
      }
      return toInterviewResponse(nextState, nextQuestion)
    }
    return toInterviewResponse(state, currentQuestion(state))
  })
}
