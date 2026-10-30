// 목업 AI. 실제 AI(김태형)는 서버에서 Upstage를 부르지만, 여기서는 정해진 규칙으로 같은 모양의 응답만 만든다.
// 인터뷰는 실제와 같은 칸 순서(travelers → 나이 → 걷기 조건 → 날짜 → 시간 → 이동수단 → 스타일·예산 → 꼭 갈 곳 → 고칠 곳)를 따른다.
import {
  InterviewResponseSchema,
  type Budget,
  type InterviewFilled,
  type InterviewRequest,
  type InterviewResponse,
  type InterviewSlot,
  type InterviewState,
  type ParseScheduleResponse,
  type PlanResponse,
  type ReviseResponse,
  type Stop,
  type Traveler,
  type Trip,
  type TripVersion,
} from '@/lib/contracts'
import { diffSummary, fixedChangeSentence, formatDiffItem, quickFixes } from '@/lib/engine'
import { judgeWithMocks } from './judge-helper'
import { mockPlaceDetails, mockPlaces } from './places'
import { makeStop } from './seed'
import { getDb, nextId } from './store'

const AGE_CHOICES = [
  { label: '50대', age: 55 }, { label: '60대', age: 65 }, { label: '70대', age: 75 }, { label: '80대 이상', age: 82 },
]
const PRESETS = [
  { label: '엄마·아빠·나', labels: ['엄마', '아빠', '나'] },
  { label: '엄마·나', labels: ['엄마', '나'] },
  { label: '아빠·나', labels: ['아빠', '나'] },
]
const CONTINUOUS_CHOICES = [
  { label: '10분 정도', value: 10 }, { label: '20분 정도', value: 20 }, { label: '30분 정도', value: 30 }, { label: '1시간 이상', value: 60 },
]
const DATE_CHOICES = ['이번 주 토요일', '다음 주 토요일']
const TIME_CHOICES = [
  { label: '오전 9시 ~ 오후 6시', start: '09:00', end: '18:00' },
  { label: '오전 10시 ~ 오후 5시', start: '10:00', end: '17:00' },
  { label: '오전 9시 ~ 오후 3시', start: '09:00', end: '15:00' },
]
const TRANSPORT_CHOICES = [
  { label: '자가용', value: 'car' as const }, { label: '대중교통', value: 'transit' as const }, { label: '택시', value: 'taxi' as const },
]
export const STYLE_CHOICES = ['관광·명소', '레저·체험', '휴식·힐링', '자연·산책', '맛집·음식', '문화·역사', '과학·전시', '온천·스파', '사진 명소', '쇼핑', '기타(직접 입력)']
const BUDGET_CHOICES: { label: string; value: Budget }[] = [
  { label: '3만 원 이하', value: 'under_30k' }, { label: '3~5만 원', value: '30k_50k' }, { label: '5~10만 원', value: '50k_100k' }, { label: '10만 원 이상', value: 'over_100k' },
]
const FIX_TARGETS = ['너무 많이 걸어요', '계단이 걱정돼요', '쉴 곳이 적어요', '시간이 빡빡해요']

type Question = { slot: InterviewSlot; text: string; choices: string[] }

function questionOf(state: InterviewState): Question {
  const { filled, cursor } = state
  const traveler = filled.travelers[cursor.travelerIndex]
  const label = traveler?.label ?? ''
  switch (cursor.slot) {
    case 'travelers':
      return { slot: 'travelers', text: '함께 가시는 분을 알려 주세요.', choices: PRESETS.map(p => p.label) }
    case 'traveler_age':
      return { slot: 'traveler_age', text: `${label}의 나이대를 알려 주세요.`, choices: [...AGE_CHOICES.map(a => a.label), '잘 모르겠어요'] }
    case 'traveler_condition':
      return { slot: 'traveler_condition', text: `${label}는 쉬지 않고 얼마나 걸을 수 있으세요?`, choices: [...CONTINUOUS_CHOICES.map(c => c.label), '잘 모르겠어요'] }
    case 'date':
      return { slot: 'date', text: '언제 가세요?', choices: DATE_CHOICES }
    case 'time':
      return { slot: 'time', text: '몇 시쯤 출발해서 몇 시쯤 돌아오실까요?', choices: TIME_CHOICES.map(c => c.label) }
    case 'transport':
      return { slot: 'transport', text: '어떻게 이동하실 거예요?', choices: TRANSPORT_CHOICES.map(c => c.label) }
    case 'styles':
      return { slot: 'styles', text: '어떤 여행을 좋아하세요? 여러 개 골라도 돼요.', choices: STYLE_CHOICES }
    case 'budget':
      return { slot: 'budget', text: '한 사람당 하루 예산은요?', choices: BUDGET_CHOICES.map(c => c.label) }
    case 'must_visit':
      return { slot: 'must_visit', text: '꼭 가고 싶은 곳이나 예약해 둔 곳이 있나요?', choices: ['없어요'] }
    case 'fix_target':
      return { slot: 'fix_target', text: '붙여 넣은 일정에서 어디를 고치고 싶으세요?', choices: FIX_TARGETS }
    default:
      return { slot: 'done', text: '다 됐어요. 이제 일정을 짜 볼게요.', choices: [] }
  }
}

const questionId = (state: InterviewState) => `${state.cursor.slot}:${state.cursor.travelerIndex}:${state.cursor.questionIndex}`

function toResponse(state: InterviewState): InterviewResponse {
  const q = questionOf(state)
  return InterviewResponseSchema.parse({ text: q.text, choices: q.choices, slot: q.slot, done: q.slot === 'done', filled: state.filled, questionId: questionId(state) })
}

const PARENT_LABELS: Record<string, 'female' | 'male'> = { 엄마: 'female', 아빠: 'male' }

function newTravelers(labels: string[]): Traveler[] {
  return labels.map((label, index) => ({
    id: `tr-new-${index + 1}`,
    label,
    pace: 'unknown',
    mobilityAid: false,
    isParent: label in PARENT_LABELS,
    ...(label in PARENT_LABELS ? { sex: PARENT_LABELS[label] } : {}),
    condition: {},
    filledBySelf: label === '나',
  }))
}

const pickIndex = (answer: { choiceIndex?: number; text?: string }, choices: string[]): number | null => {
  if (answer.choiceIndex !== undefined) return answer.choiceIndex < choices.length ? answer.choiceIndex : null
  const index = choices.findIndex(c => c.replace(/\s+/g, '') === (answer.text ?? '').replace(/\s+/g, ''))
  return index >= 0 ? index : null
}

function afterTraveler(filled: InterviewFilled, index: number): InterviewState['cursor'] {
  return index + 1 < filled.travelers.length
    ? { slot: 'traveler_age', travelerIndex: index + 1, questionIndex: 0 }
    : { slot: 'date', travelerIndex: 0, questionIndex: 0 }
}

function applyAnswer(state: InterviewState, answer: { choiceIndex?: number; text?: string }): InterviewState {
  const filled: InterviewFilled = structuredClone(state.filled)
  const { slot, travelerIndex } = state.cursor
  const q = questionOf(state)
  const pick = pickIndex(answer, q.choices)
  const retry = (): InterviewState => ({ ...state, history: [...state.history, { role: 'assistant', text: `다시 여쭤볼게요. ${q.text}` }] })
  const go = (cursor: InterviewState['cursor']): InterviewState => {
    const next: InterviewState = { ...state, filled, cursor }
    const userText = answer.choiceIndex !== undefined ? (q.choices[answer.choiceIndex] ?? '') : (answer.text ?? '')
    return { ...next, history: [...state.history, { role: 'user', text: userText }, { role: 'assistant', text: questionOf(next).text }] }
  }
  const traveler = filled.travelers[travelerIndex]
  switch (slot) {
    case 'travelers': {
      if (pick === null) return retry()
      filled.travelers = newTravelers(PRESETS[pick].labels)
      return go({ slot: 'traveler_age', travelerIndex: 0, questionIndex: 0 })
    }
    case 'traveler_age': {
      if (pick === null || !traveler) return retry()
      if (pick < AGE_CHOICES.length) traveler.age = AGE_CHOICES[pick].age
      return go(traveler.isParent ? { slot: 'traveler_condition', travelerIndex, questionIndex: 0 } : afterTraveler(filled, travelerIndex))
    }
    case 'traveler_condition': {
      if (pick === null || !traveler) return retry()
      if (pick < CONTINUOUS_CHOICES.length) traveler.condition = { ...traveler.condition, continuousMin: CONTINUOUS_CHOICES[pick].value }
      return go(afterTraveler(filled, travelerIndex))
    }
    case 'date': {
      if (pick === null) return retry()
      const base = new Date()
      const toSaturday = (6 - base.getDay() + 7) % 7 || 7
      base.setDate(base.getDate() + toSaturday + pick * 7)
      filled.date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
      return go({ slot: 'time', travelerIndex: 0, questionIndex: 0 })
    }
    case 'time': {
      if (pick === null) return retry()
      filled.startTime = TIME_CHOICES[pick].start
      filled.endTime = TIME_CHOICES[pick].end
      return go({ slot: 'transport', travelerIndex: 0, questionIndex: 0 })
    }
    case 'transport': {
      if (pick === null) return retry()
      filled.transport = TRANSPORT_CHOICES[pick].value
      return go({ slot: filled.mode === 'scratch' ? 'styles' : 'must_visit', travelerIndex: 0, questionIndex: 0 })
    }
    case 'styles': {
      const picked = answer.choiceIndex !== undefined
        ? [STYLE_CHOICES[answer.choiceIndex] ?? '']
        : (answer.text ?? '').split(/[,、，]/).map(s => s.trim().slice(0, 30)).filter(Boolean)
      if (picked.filter(Boolean).length === 0) return retry()
      filled.styles = [...new Set(picked.filter(Boolean))].slice(0, 10)
      return go({ slot: 'budget', travelerIndex: 0, questionIndex: 0 })
    }
    case 'budget': {
      if (pick === null) return retry()
      filled.budget = BUDGET_CHOICES[pick].value
      return go({ slot: 'must_visit', travelerIndex: 0, questionIndex: 0 })
    }
    case 'must_visit': {
      const text = (answer.text ?? '').trim()
      filled.mustVisit = answer.choiceIndex !== undefined || /^(없어요|없음|없습니다)$/.test(text) || text === '' ? [] : text.split(/[,、，]/).map(name => ({ name: name.trim() })).filter(m => m.name)
      return go({ slot: filled.mode === 'paste' ? 'fix_target' : 'done', travelerIndex: 0, questionIndex: 0 })
    }
    case 'fix_target': {
      const text = answer.choiceIndex !== undefined ? FIX_TARGETS[answer.choiceIndex] : answer.text?.trim()
      if (!text) return retry()
      filled.fixTargets = [text]
      return go({ slot: 'done', travelerIndex: 0, questionIndex: 0 })
    }
    default:
      return state
  }
}

export function mockInterview(trip: Trip, req: InterviewRequest): InterviewResponse {
  const db = getDb()
  let state = db.interviews[trip.id]
  if (!state) {
    state = {
      filled: { mode: trip.mode, travelers: [], styles: [...trip.styles], mustVisit: [], fixTargets: [] },
      cursor: { slot: 'travelers', travelerIndex: 0, questionIndex: 0 },
      history: [],
    }
    state.history.push({ role: 'assistant', text: questionOf(state).text })
  }
  // 받은 질문 표시가 지금 질문과 다르면(같은 답이 두 번 온 경우) 답을 적용하지 않고 같은 질문을 돌려준다
  if (req.answer && (!req.questionId || req.questionId === questionId(state))) state = applyAnswer(state, req.answer)
  db.interviews[trip.id] = state
  return toResponse(state)
}

// ───────── 붙여넣은 일정 정리 ─────────
const ALIASES: Record<string, string[]> = {
  hanbat: ['한밭수목원', '수목원'],
  science: ['국립중앙과학관', '과학관'],
  art: ['대전시립미술관', '시립미술관', '미술관'],
  leeungno: ['이응노미술관', '이응노'],
  hanbit: ['한빛탑', '엑스포'],
  'lunch-dorong': ['점심', '식당', '한식'],
}

export function mockParseSchedule(text: string): ParseScheduleResponse {
  const tokens = text.split(/[\n,→>]|\s-\s|그리고|다음에|그다음/).map(t => t.trim()).filter(Boolean)
  const stops: Stop[] = []
  const unmatched: string[] = []
  for (const token of tokens) {
    const time = token.match(/(\d{1,2}):(\d{2})/)
    const placeId = Object.keys(ALIASES).find(id => ALIASES[id].some(alias => token.includes(alias)))
    const place = placeId ? mockPlaces[placeId] : undefined
    if (place && !stops.some(s => s.placeId === place.id)) {
      stops.push(makeStop({
        key: `s-${place.id}`, name: place.name, placeId: place.id, visitMin: place.visitMin,
        startTime: time ? `${time[1].padStart(2, '0')}:${time[2]}` : undefined,
      }))
    } else if (!place && token.length > 1 && !/^[\d:\s시분]+$/.test(token)) {
      unmatched.push(token)
    }
  }
  return { stops, unmatched }
}

// ───────── 처음부터 일정 짜기 ─────────
const addMinutes = (time: string, min: number) => {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, h * 60 + m + min)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const ARRIVE_BY = { car: 'car', transit: 'bus', taxi: 'taxi' } as const

export function mockGenerate(trip: Trip, travelers: Traveler[]): PlanResponse {
  const db = getDb()
  const filled = db.interviews[trip.id]?.filled
  const styles = filled?.styles.length ? filled.styles : trip.styles
  const arriveBy = ARRIVE_BY[filled?.transport ?? trip.transport ?? 'car']
  const must = new Set(filled?.mustVisit.map(m => m.name) ?? [])
  const candidates = mockPlaceDetails.filter(p => p.category !== '음식점')
  const scored = candidates
    .map(p => ({ p, score: (must.has(p.name) ? 10 : 0) + p.styles.filter(s => styles.includes(s)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.p)
  const ordered = ['hanbat', 'science', 'art', 'leeungno', 'hanbit'].map(id => scored.find(p => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
  const lunch = mockPlaces['lunch-dorong']
  const items = [...ordered.slice(0, 1), lunch, ...ordered.slice(1)]
  let clock = filled?.startTime ?? '09:30'
  const stops = items.map((place, index) => {
    const stop = makeStop({
      key: `s-${place.id}`, name: place.name, placeId: place.id, startTime: clock, visitMin: place.visitMin,
      mustVisit: must.has(place.name), arriveBy: index === 0 ? arriveBy : arriveBy,
    })
    clock = addMinutes(clock, (place.visitMin ?? 60) + 20)
    return stop
  })
  const version = saveMockVersion(trip.id, null, 'ai', stops, '처음 짠 일정이에요', null, travelers)
  const { summary } = judgeWithMocks(stops, travelers)
  return { version, summary }
}

// 서버가 버전을 저장할 때 하는 일: 번호 매기기 + 판정 요약 붙이기
export function saveMockVersion(tripId: string, parentId: string | null, madeBy: TripVersion['madeBy'], stops: Stop[], note: string | null | undefined, userId: string | null, travelers: Traveler[]): TripVersion {
  const db = getDb()
  const number = Math.max(0, ...db.versions.filter(v => v.tripId === tripId).map(v => v.number)) + 1
  // 여행자가 아직 없으면(붙여넣기 직후) 판정 요약은 null 로 저장하고 나중에 채운다 (docs/roles/account-trip.md)
  const summary = travelers.length > 0 ? judgeWithMocks(stops, travelers).summary : null
  const version: TripVersion = {
    id: nextId('v'), tripId, number, parentId, madeBy, madeByUserId: userId, stops, summary, note: note ?? null, createdAt: new Date().toISOString(),
  }
  db.versions.push(version)
  return version
}

// ───────── 의견 반영해서 다시 짜기 ─────────
export function mockRevise(trip: Trip, versionId: string, travelers: Traveler[]): ReviseResponse {
  const db = getDb()
  const base = db.versions.find(v => v.id === versionId && v.tripId === trip.id)
  if (!base) throw new Error('버전을 찾을 수 없어요')
  const opinions = db.opinions.filter(o => o.versionId === versionId && !o.appliedInVersionId)
  let stops: Stop[] = structuredClone(base.stops)
  for (const opinion of opinions) {
    const stop = stops.find(s => s.key === opinion.stopKey)
    const place = stop?.placeId ? mockPlaces[stop.placeId] : undefined
    if (!stop || !place) continue
    if (opinion.reactions.includes('must_go')) stop.mustVisit = true
    if (opinion.reactions.includes('stairs_worry')) {
      for (const seg of place.segments) if (seg.stairsStatus === 'present') {
        const detour = place.segments.find(s => s.detourOf === seg.id)
        if (detour) stop.detourMap[seg.id] = detour.id
      }
    }
    if (opinion.reactions.includes('need_rest')) {
      const rest = place.nodes.find(n => n.kind === 'rest')
      if (rest && !stop.restNodeIds.includes(rest.id)) stop.restNodeIds.push(rest.id)
    }
    if (opinion.reactions.includes('too_far')) {
      for (const seg of place.segments) if (seg.optional && !stop.skipSegmentIds.includes(seg.id)) stop.skipSegmentIds.push(seg.id)
    }
  }
  // 그래도 조건을 넘으면 계산 엔진의 빠른 수정안 중 위반이 사라지는 첫 안을 쓴다
  const judged = judgeWithMocks(stops, travelers)
  if (judged.result.violations.length > 0) {
    const fixes = quickFixes({ travelers, stops, places: judged.places, legs: judged.legs })
    const fix = fixes.find(f => f.enough) ?? fixes[fixes.length - 1]
    if (fix) stops = fix.stops
  }
  const version = saveMockVersion(trip.id, versionId, 'ai', stops, '의견을 반영해서 다시 짰어요', null, travelers)
  for (const opinion of opinions) opinion.appliedInVersionId = version.id
  const { summary } = judgeWithMocks(stops, travelers)
  return { version, summary, appliedOpinionIds: opinions.map(o => o.id) }
}

// ───────── 바뀐 점 한 줄 ─────────
export function mockExplain(prev: Parameters<typeof diffSummary>[0], next: Parameters<typeof diffSummary>[1], changes: Parameters<typeof fixedChangeSentence>[0] = []): string {
  const parts = diffSummary(prev, next).map(formatDiffItem)
  const change = changes.length > 0 ? fixedChangeSentence(changes) : ''
  return [change, parts.join(', ')].filter(Boolean).join(' — ') || '바뀐 점이 없어요'
}
