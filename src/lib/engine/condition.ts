// 걷기 조건 인터뷰의 생활 예시 질문 (설계 7.1.2). 순수 TypeScript — 브라우저·서버 공용.
import type { Condition, Pace, Traveler } from '@/lib/contracts'

export type ConditionQuestionId = 'continuousMin' | 'dayMin' | 'restMin' | 'avoidStairs' | 'pace' | 'mobilityAid'
export type ConditionChoice = { label: string; note: string; value: number | boolean | Pace }
export type ConditionQuestion = {
  id: ConditionQuestionId
  title: string
  choices: ConditionChoice[]
  allowUnknown: boolean        // '잘 모르겠어요' 버튼을 보여줄지
  unknownNote?: string         // '잘 모르겠어요' 아래 작은 글씨
}

export const UNKNOWN_CHOICE_LABEL = '잘 모르겠어요'

export const CONDITION_QUESTIONS: readonly ConditionQuestion[] = [
  {
    id: 'continuousMin',
    title: '쉬지 않고 얼마나 걸으실 수 있나요?',
    choices: [
      { label: '집 앞 편의점까지', note: '약 10분', value: 10 },
      { label: '동네 마트까지', note: '약 20분', value: 20 },
      { label: '버스 한 정거장', note: '약 30분', value: 30 },
    ],
    allowUnknown: true,
    unknownNote: '기본값 20분',
  },
  {
    id: 'dayMin',
    title: '하루에 모두 합쳐 얼마나 걸으셔도 괜찮나요?',
    choices: [
      { label: '동네 한 바퀴', note: '약 30분', value: 30 },
      { label: '시장 장보기', note: '약 60분', value: 60 },
      { label: '반나절 나들이', note: '약 90분', value: 90 },
    ],
    allowUnknown: true,
    unknownNote: '기본값 60분',
  },
  {
    id: 'restMin',
    title: '한 번 쉴 때 얼마나 쉬셔야 하나요?',
    choices: [
      { label: '잠깐 앉으면 돼요', note: '약 5분', value: 5 },
      { label: '차 한 잔 정도', note: '약 10분', value: 10 },
      { label: '넉넉히', note: '약 20분', value: 20 },
    ],
    allowUnknown: true,
    unknownNote: '기본값 10분',
  },
  {
    id: 'avoidStairs',
    title: '계단은 피하시는 게 좋을까요?',
    choices: [
      { label: '피하고 싶어요', note: '계단 없는 길을 찾아요', value: true },
      { label: '괜찮아요', note: '계단도 포함해요', value: false },
    ],
    allowUnknown: true,
    unknownNote: '기본값: 피하기',
  },
  {
    id: 'pace',
    title: '걷는 속도는 어떠세요?',
    choices: [
      { label: '천천히 걸으세요', note: '여유 있게 계산해요', value: 'slow' },
      { label: '보통이에요', note: '평균 속도로 계산해요', value: 'normal' },
    ],
    allowUnknown: true,
    unknownNote: '나이에 맞춰 계산해요',
  },
  {
    id: 'mobilityAid',
    title: '지팡이나 보행기를 쓰시나요?',
    choices: [
      { label: '네', note: '지팡이·보행기 속도로 계산해요', value: true },
      { label: '아니요', note: '나이에 맞춰 계산해요', value: false },
    ],
    allowUnknown: false,
  },
]

// 값은 고른 선택지 번호. 없거나 null이거나 범위 밖이면 '잘 모르겠어요'
export type ConditionAnswers = Partial<Record<ConditionQuestionId, number | null>>

// 번호가 범위 안의 정수면 그 선택지, 아니면 잘 모르겠어요(undefined) 취급
function pickChoice(q: ConditionQuestion, n: number | null | undefined): ConditionChoice | undefined {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= q.choices.length) return undefined
  return q.choices[n]
}

// 고른 칸만 condition에 넣는다 — 모르면 키 자체를 넣지 않는다(undefined 값도 금지)
export function conditionFromAnswers(answers: ConditionAnswers): Pick<Traveler, 'condition' | 'pace' | 'mobilityAid'> {
  const condition: Partial<Condition> = {}
  for (const id of ['continuousMin', 'dayMin', 'restMin'] as const) {
    const choice = pickChoice(CONDITION_QUESTIONS.find(q => q.id === id)!, answers[id])
    if (choice && typeof choice.value === 'number') condition[id] = choice.value
  }

  const stairs = pickChoice(CONDITION_QUESTIONS.find(q => q.id === 'avoidStairs')!, answers.avoidStairs)
  if (stairs && typeof stairs.value === 'boolean') condition.avoidStairs = stairs.value

  const paceChoice = pickChoice(CONDITION_QUESTIONS.find(q => q.id === 'pace')!, answers.pace)
  const pace: Pace = paceChoice && (paceChoice.value === 'slow' || paceChoice.value === 'normal') ? paceChoice.value : 'unknown'

  // 보조기구는 '잘 모르겠어요'가 없으니 답이 없으면 아니요(false)로 본다
  const aid = pickChoice(CONDITION_QUESTIONS.find(q => q.id === 'mobilityAid')!, answers.mobilityAid)
  const mobilityAid = aid && typeof aid.value === 'boolean' ? aid.value : false

  return { condition, pace, mobilityAid }
}
