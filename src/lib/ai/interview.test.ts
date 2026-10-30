// 인터뷰(칸 채우기 대화) 검사. AI는 가짜 callJson으로만 부른다.
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CONDITION_QUESTIONS, conditionFromAnswers } from '@/lib/engine/condition'
import {
  InterviewResponseSchema,
  InterviewStateSchema,
  type InterviewAnswer,
  type InterviewResponse,
  type InterviewSlot,
  type InterviewState,
  type StartMode,
  type Traveler,
} from '@/lib/contracts'
import { POST } from '@/app/api/ai/interview/route'
import { AiCallError } from './client'
import { createDevDeps } from './dev-deps'
import type { AiDeps } from './deps'
import { applyAnswer, currentQuestion, handleInterview, initialState, questionIdFor } from './interview'

function makeRequest(body: unknown, userId: string | null = 'u-mom'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (userId !== null) headers['x-dev-user'] = userId
  return new Request('https://example.com/api/ai/interview', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

// 실패하면 던지는 가짜 — 선택 답만 쓰는 흐름에서 AI를 부르지 않음을 확인한다
function throwingCallJson(counter?: { calls: number }): AiDeps['callJson'] {
  return (async () => {
    if (counter) counter.calls += 1
    throw new AiCallError('no_provider', '테스트에서는 AI를 부르지 않는다')
  }) as unknown as AiDeps['callJson']
}

// 정해진 값을 스키마로 검사해 돌려주는 가짜
function stubCallJson(value: unknown, counter?: { calls: number }): AiDeps['callJson'] {
  return (async (req: { schema: z.ZodType<unknown> }) => {
    if (counter) counter.calls += 1
    return req.schema.parse(value)
  }) as unknown as AiDeps['callJson']
}

function failingCallJson(): AiDeps['callJson'] {
  return (async () => {
    throw new AiCallError('provider_failed', '공급자 호출 실패')
  }) as unknown as AiDeps['callJson']
}

// 함께 가는 사람이 아직 없을 때의 getTripContext — 첫 질문부터 시작하게 한다
function depsForFlow(mode: StartMode, callJson: AiDeps['callJson']): AiDeps {
  const deps = createDevDeps()
  return {
    ...deps,
    callJson,
    getTripContext: async () => ({
      trip: { id: 'trip-dev', groupId: 'g-dev', startMode: mode },
      travelers: [],
      versions: [],
    }),
  }
}

// 슬롯마다 고르는 번호 — 끝까지 선택으로만 간다
function pickForSlot(body: InterviewResponse): InterviewAnswer {
  if (body.slot === 'traveler_age') return { choiceIndex: 1 }
  if (body.slot === 'traveler_height') return { choiceIndex: 1 }
  if (body.slot === 'traveler_sex') return { choiceIndex: 0 }
  if (body.slot === 'traveler_condition_gate') return { choiceIndex: 0 }
  if (body.slot === 'traveler_condition') return { choiceIndex: 1 }
  if (body.slot === 'time') return { choiceIndex: 1 }
  if (body.slot === 'budget') return { choiceIndex: 1 }
  return { choiceIndex: 0 }
}

async function driveToDone(
  mode: StartMode,
  deps: AiDeps,
): Promise<{ responses: InterviewResponse[]; seen: InterviewSlot[] }> {
  const responses: InterviewResponse[] = []
  const seen: InterviewSlot[] = []
  let answer: InterviewAnswer | undefined
  let questionId: string | undefined
  for (let i = 0; i < 60; i++) {
    const response = await handleInterview(
      makeRequest({ tripId: 'trip-dev', ...(answer === undefined ? {} : { answer, questionId }) }),
      deps,
    )
    expect(response.status).toBe(200)
    // 매 응답이 계약을 통과해야 한다
    const body = InterviewResponseSchema.parse(await response.json())
    responses.push(body)
    seen.push(body.slot)
    // 모든 응답에 질문 표시가 있다
    expect(body.questionId).toBe(`${body.slot}:${body.questionId.split(':')[1]}:${body.questionId.split(':')[2]}`)
    if (body.done) return { responses, seen }
    answer = pickForSlot(body)
    questionId = body.questionId
  }
  throw new Error('done에 닿지 못했다')
}

function parentTraveler(label = '엄마'): Traveler {
  return {
    id: 't1',
    label,
    sex: 'female',
    pace: 'unknown',
    mobilityAid: false,
    isParent: true,
    condition: {},
    filledBySelf: false,
  }
}

describe('initialState·currentQuestion', () => {
  it('처음 부르면 함께 가는 사람 질문', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    // 첫 호출에 답을 보내도 무시하고 첫 질문을 돌려준다
    const response = await handleInterview(makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 0 } }), deps)
    expect(response.status).toBe(200)
    const body = InterviewResponseSchema.parse(await response.json())
    expect(body.slot).toBe('travelers')
    expect(body.text).toBe('함께 가시는 분을 알려 주세요.')
    expect(body.choices).toEqual(['엄마·아빠·나', '엄마·나', '아빠·나'])
    expect(body.done).toBe(false)
    expect(body.questionId).toBe('travelers:0:0')
  })

  it('여행자가 이미 있으면 함께 가는 사람 질문을 건너뜀', () => {
    const state = initialState('scratch', [parentTraveler()])
    const question = currentQuestion(state)
    expect(question.slot).toBe('traveler_age')
    expect(question.text).toBe('엄마는 연세가 어떻게 되세요?')
    expect(questionIdFor(state.cursor)).toBe('traveler_age:0:0')
  })

  it('받침에 따라 은/는을 붙인다', () => {
    const mom = currentQuestion(initialState('scratch', [parentTraveler('엄마')]))
    expect(mom.text).toBe('엄마는 연세가 어떻게 되세요?')
    const grandpa = currentQuestion(initialState('scratch', [parentTraveler('할아버지')]))
    expect(grandpa.text).toBe('할아버지는 연세가 어떻게 되세요?')
    const sibling: Traveler = {
      id: 't9',
      label: '동생',
      pace: 'unknown',
      mobilityAid: false,
      isParent: false,
      condition: {},
      filledBySelf: true,
    }
    const other = currentQuestion(initialState('scratch', [sibling]))
    expect(other.text).toBe('동생은 나이가 어떻게 되세요?')
  })
})

describe('선택으로 끝까지', () => {
  it('선택으로 끝까지 가면 done이고 여행자 저장', async () => {
    const counter = { calls: 0 }
    const deps = depsForFlow('scratch', throwingCallJson(counter))
    const savedTravelers: Traveler[][] = []
    deps.saveTravelers = async (tripId, travelers) => {
      expect(tripId).toBe('trip-dev')
      savedTravelers.push(travelers)
    }

    const { responses, seen } = await driveToDone('scratch', deps)
    const last = responses[responses.length - 1]!
    expect(last.done).toBe(true)
    expect(last.slot).toBe('done')
    expect(last.text).toBe('다 됐어요. 이제 일정을 짜 볼게요.')
    expect(last.choices).toEqual([])
    // 선택으로만 갔으니 AI를 한 번도 부르지 않는다
    expect(counter.calls).toBe(0)

    expect(savedTravelers.length).toBeGreaterThan(0)
    const travelers = savedTravelers[savedTravelers.length - 1]!
    expect(travelers.map(t => t.label)).toEqual(['엄마', '아빠', '나'])
    const mom = travelers[0]!
    expect(mom.isParent).toBe(true)
    expect(mom.sex).toBe('female')
    expect(mom.age).toBe(65)
    expect(mom.condition.continuousMin).toBe(20)
    const me = travelers[2]!
    expect(me.isParent).toBe(false)
    expect(me.condition).toEqual({})
    expect(last.filled.styles).toContain('관광·명소')
    expect(last.filled.budget).toBe('30k_50k')
    expect(seen).toContain('styles')
    expect(seen).toContain('budget')
    expect(seen).not.toContain('fix_target')
  })

  it('history가 질문·답을 쌓는다', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    await handleInterview(makeRequest({ tripId: 'trip-dev' }), deps)
    const stored = await deps.interviews.get('trip-dev')
    expect(stored?.history.length).toBe(1)
    const q = currentQuestion(stored!)
    await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 1 }, questionId: questionIdFor(stored!.cursor) }),
      deps,
    )
    const stored2 = await deps.interviews.get('trip-dev')
    // 질문 1 + (답 1 + 질문 1) = 3
    expect(stored2?.history.length).toBe(3)
    expect(stored2?.history[1]).toEqual({ role: 'user', text: q.choices[1] })
  })
})

describe('여행자 칸', () => {
  it('엄마는 부모님·여성으로 정해져 성별을 묻지 않음', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [])
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
    expect(state.filled.travelers.map(t => t.label)).toEqual(['엄마', '아빠', '나'])
    expect(state.filled.travelers[0]).toMatchObject({ isParent: true, sex: 'female' })
    expect(state.filled.travelers[1]).toMatchObject({ isParent: true, sex: 'male' })
    expect(state.filled.travelers[2]).toMatchObject({ isParent: false })
    expect(state.filled.travelers[2]?.sex).toBeUndefined()

    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    expect(state.filled.travelers[0]?.age).toBe(65)
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    expect(state.filled.travelers[0]?.heightCm).toBe(160)
    // 이름표로 성별이 정해졌으니 관문으로 바로 간다
    expect(currentQuestion(state).slot).toBe('traveler_condition_gate')
  })

  it('이름표는 공백을 뺀 뒤 정확히 같을 때만 부모님으로 본다', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [])
    state = (
      await applyAnswer(
        state,
        { text: '엄마' },
        { callJson: stubCallJson({ travelers: [{ label: '엄마' }] }) },
      )
    ).state
    expect(state.filled.travelers[0]).toMatchObject({ isParent: true })
    // '엄마야'는 정확히 같지 않으므로 부모님이 아니다 — AI가 그대로 돌려준 이름표로 판단한다
    const out = await applyAnswer(initialState('scratch', []), { text: '엄마야' }, {
      callJson: stubCallJson({ travelers: [{ label: '엄마야' }] }),
    })
    expect(out.state.filled.travelers[0]?.isParent).toBe(false)
    expect(deps.callJson).toBeDefined()
  })

  it('이미 있는 여행자도 부모님인데 성별이 비면 이름표로 채운다', async () => {
    const bare: Traveler = {
      id: 't1',
      label: '엄마',
      pace: 'unknown',
      mobilityAid: false,
      isParent: true,
      condition: {},
      filledBySelf: false,
    }
    let state = initialState('scratch', [bare])
    expect(state.filled.travelers[0]?.sex).toBeUndefined()
    state = (await applyAnswer(state, { choiceIndex: 2 }, { callJson: throwingCallJson() })).state
    expect(state.filled.travelers[0]?.sex).toBe('female')
  })

  it('부모님께 직접 받기면 조건을 비움(이미 있던 값도 지움), filledBySelf false', async () => {
    const deps = { callJson: throwingCallJson() }
    const mom: Traveler = {
      ...parentTraveler(),
      age: 70,
      heightCm: 160,
      pace: 'slow',
      mobilityAid: true,
      condition: { continuousMin: 30, avoidStairs: false },
      filledBySelf: false,
    }
    let state = initialState('scratch', [mom])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 60대
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 160cm
    expect(currentQuestion(state).slot).toBe('traveler_condition_gate')

    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 부모님께 직접 받을게요
    const out = state.filled.travelers[0]!
    expect(out.filledBySelf).toBe(false)
    expect(out.condition).toEqual({})
    expect(out.pace).toBe('unknown')
    expect(out.mobilityAid).toBe(false)
    // 조건 6문항을 건너뛰고 다음 여행자로 간다
    expect(currentQuestion(state).slot).toBe('date')
  })

  it('자녀가 불편 없음이면 조건 비움(이미 있던 값도 지움)', async () => {
    const deps = { callJson: throwingCallJson() }
    const kid: Traveler = {
      id: 't9',
      label: '나',
      pace: 'slow',
      mobilityAid: true,
      isParent: false,
      condition: { continuousMin: 30 },
      filledBySelf: true,
    }
    let state = initialState('scratch', [kid])
    state = (await applyAnswer(state, { choiceIndex: 2 }, deps)).state // 30대 → 35
    expect(state.filled.travelers[0]?.age).toBe(35)
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 160cm 안팎
    expect(currentQuestion(state).slot).toBe('traveler_sex')
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state // 여성
    expect(state.filled.travelers[0]?.sex).toBe('female')
    expect(currentQuestion(state).slot).toBe('traveler_condition_gate')
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state // 없어요
    expect(state.filled.travelers[0]?.condition).toEqual({})
    expect(state.filled.travelers[0]?.pace).toBe('unknown')
    expect(state.filled.travelers[0]?.mobilityAid).toBe(false)
    expect(state.filled.travelers[0]?.filledBySelf).toBe(true)
    expect(currentQuestion(state).slot).toBe('date')
  })

  it('걷기 조건 답이 condition에 들어감(마트까지 → 20)', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [parentTraveler()])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    expect(currentQuestion(state).slot).toBe('traveler_condition_gate')
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state // 지금 대신 답할게요
    const question = currentQuestion(state)
    expect(question.slot).toBe('traveler_condition')
    expect(question.text).toBe('쉬지 않고 얼마나 걸으실 수 있나요?')
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 동네 마트까지
    expect(state.filled.travelers[0]?.condition.continuousMin).toBe(20)
  })

  it('걷기 조건 6문항 × 선택이 conditionFromAnswers와 같다', async () => {
    const deps = { callJson: throwingCallJson() }
    for (let answerIndex = 0; answerIndex < CONDITION_QUESTIONS.length; answerIndex++) {
      const q = CONDITION_QUESTIONS[answerIndex]!
      const choiceCount = q.allowUnknown ? q.choices.length + 1 : q.choices.length
      for (let choice = 0; choice < choiceCount; choice++) {
        let state = initialState('scratch', [parentTraveler()])
        state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
        state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
        state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
        for (let i = 0; i < answerIndex; i++) {
          state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
        }
        state = (await applyAnswer(state, { choiceIndex: choice }, deps)).state
        // 그 문항까지 답한 뒤의 여행자 값을 conditionFromAnswers(같은 번호)와 비교한다
        const answers: Record<string, number> = {}
        for (let i = 0; i <= answerIndex; i++) {
          answers[CONDITION_QUESTIONS[i]!.id] = i < answerIndex ? 0 : choice
        }
        const expected = conditionFromAnswers(answers as never)
        const got = state.filled.travelers[0]!
        expect(got.condition).toEqual(expected.condition)
        expect(got.pace).toBe(expected.pace)
        expect(got.mobilityAid).toBe(expected.mobilityAid)
      }
    }
  })

  it('부분 일치를 없앰 — 계단 질문에 안 괜찮아요는 다시 묻기', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [parentTraveler()])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
    // continuousMin·dayMin·restMin을 지나 계단 질문까지 간다
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    expect(currentQuestion(state).text).toBe('계단은 피하시는 게 좋을까요?')
    const out = await applyAnswer(state, { text: '안 괜찮아요' }, deps)
    expect(out.retryText).toContain('아래에서 골라 주세요')
    expect(out.state.cursor).toEqual(state.cursor)
  })

  it('보조기구에 아니네요는 다시 묻기', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [parentTraveler()])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
    for (let i = 0; i < 5; i++) {
      state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
    }
    expect(currentQuestion(state).text).toBe('지팡이나 보행기를 쓰시나요?')
    const out = await applyAnswer(state, { text: '아니네요' }, deps)
    expect(out.retryText).toContain('아래에서 골라 주세요')
  })

  it('잘 모르겠어요는 칸 비움', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [parentTraveler()])
    state = (await applyAnswer(state, { choiceIndex: 4 }, deps)).state // 잘 모르겠어요
    expect(state.filled.travelers[0]?.age).toBeUndefined()
    state = (await applyAnswer(state, { choiceIndex: 4 }, deps)).state // 잘 모르겠어요
    expect(state.filled.travelers[0]?.heightCm).toBeUndefined()
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state // 대신 답하기
    state = (await applyAnswer(state, { choiceIndex: 3 }, deps)).state // 잘 모르겠어요
    expect(state.filled.travelers[0]?.condition.continuousMin).toBeUndefined()
    expect(state.filled.travelers[0]?.condition).toEqual({})
  })

  it('직접 입력 나이는 정규식으로(“72세” → 72)', async () => {
    const counter = { calls: 0 }
    const deps = { callJson: throwingCallJson(counter) }
    let state = initialState('scratch', [])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 엄마·나
    const out = await applyAnswer(state, { text: '72세' }, deps)
    expect(out.retryText).toBeUndefined()
    expect(out.state.filled.travelers[0]?.age).toBe(72)
    expect(counter.calls).toBe(0)
  })

  it('몰라·모르는 모름으로 나이 비움', async () => {
    const counter = { calls: 0 }
    const deps = { callJson: throwingCallJson(counter) }
    const state = initialState('scratch', [parentTraveler()])
    const out = await applyAnswer(state, { text: '몰라요' }, deps)
    expect(out.retryText).toBeUndefined()
    expect(out.state.filled.travelers[0]?.age).toBeUndefined()
    expect(counter.calls).toBe(0)
  })

  it('1950년생은 서울 기준 올해에서 뺀다', async () => {
    const counter = { calls: 0 }
    const deps = { callJson: throwingCallJson(counter) }
    const state = initialState('scratch', [parentTraveler()])
    const out = await applyAnswer(state, { text: '1950년생' }, deps, new Date(2026, 9, 30))
    expect(out.retryText).toBeUndefined()
    expect(out.state.filled.travelers[0]?.age).toBe(76)
    expect(counter.calls).toBe(0)
  })

  it('두 사람이 섞인 말은 AI로 나이 숫자를 받음', async () => {
    const counter = { calls: 0 }
    const deps = { callJson: stubCallJson({ age: 75 }, counter) }
    let state = initialState('scratch', [])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 엄마·나
    const out = await applyAnswer(state, { text: '엄마는 일흔둘이고 아빠는 75' }, deps)
    expect(out.retryText).toBeUndefined()
    expect(out.state.filled.travelers[0]?.age).toBe(75)
    expect(counter.calls).toBeGreaterThan(0)
  })

  it('AI가 null을 주면 나이를 다시 묻는다', async () => {
    const deps = { callJson: stubCallJson({ age: null }) }
    let state = initialState('scratch', [])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
    const out = await applyAnswer(state, { text: '글쎄요' }, deps)
    expect(out.retryText).toContain('다시 여쭤볼게요')
  })

  it('미터 표기 키는 cm로 (“1m70”·“1.7m” → 170)', async () => {
    const deps = { callJson: throwingCallJson() }
    const toHeight = async (text: string) => {
      let state = initialState('scratch', [parentTraveler()])
      state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state
      return applyAnswer(state, { text }, deps)
    }
    expect((await toHeight('1m70')).state.filled.travelers[0]?.heightCm).toBe(170)
    expect((await toHeight('1.7m')).state.filled.travelers[0]?.heightCm).toBe(170)
    const bad = await toHeight('30cm')
    expect(bad.retryText).toContain('아래에서 골라 주세요')
  })

  it('자유 입력 여행자는 AI로 채움', async () => {
    const deps = { callJson: stubCallJson({ travelers: [{ label: '할머니' }] }) }
    const state = initialState('scratch', [])
    const out = await applyAnswer(state, { text: '할머니 모시고 가요' }, deps)
    expect(out.retryText).toBeUndefined()
    expect(out.state.filled.travelers.map(t => t.label)).toEqual(['할머니'])
    expect(out.state.filled.travelers[0]).toMatchObject({ isParent: true, sex: 'female' })
  })

  it('예순 살 같은 말은 AI로 나이 숫자를 받음', async () => {
    const deps = { callJson: stubCallJson({ age: 60 }) }
    let state = initialState('scratch', [])
    state = (await applyAnswer(state, { choiceIndex: 1 }, deps)).state // 엄마·나
    const out = await applyAnswer(state, { text: '예순 살' }, deps)
    expect(out.retryText).toBeUndefined()
    expect(out.state.filled.travelers[0]?.age).toBe(60)
  })

  it('filledBySelf는 본인만 true, 부모님은 false', async () => {
    const deps = { callJson: throwingCallJson() }
    let state = initialState('scratch', [])
    state = (await applyAnswer(state, { choiceIndex: 0 }, deps)).state
    expect(state.filled.travelers[0]?.filledBySelf).toBe(false)
    expect(state.filled.travelers[1]?.filledBySelf).toBe(false)
    expect(state.filled.travelers[2]?.filledBySelf).toBe(true)
  })
})

describe('AI 해석 실패·범위 밖 선택·질문 표시', () => {
  it('AI 해석 실패면 같은 질문 다시', async () => {
    const deps = { callJson: failingCallJson() }
    const state = initialState('scratch', [])
    const out = await applyAnswer(state, { text: '엄마랑 아빠랑 갈 거야' }, deps)
    expect(out.retryText).toContain('다시 여쭤볼게요')
    expect(out.state.cursor).toEqual(state.cursor)
    expect(out.state.filled.travelers).toEqual([])
  })

  it('AI 실패가 AiCallError가 아니면 다시 던진다', async () => {
    const bad: AiDeps['callJson'] = (async () => {
      throw new Error('엉뚱한 오류')
    }) as unknown as AiDeps['callJson']
    const state = initialState('scratch', [])
    await expect(applyAnswer(state, { text: '엄마랑 갈 거야' }, { callJson: bad })).rejects.toThrow('엉뚱한 오류')
  })

  it('AI 실패 응답은 같은 질문에 접두사를 붙임', async () => {
    const deps = depsForFlow('scratch', failingCallJson())
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'date', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    await deps.interviews.save('trip-dev', planted)
    const response = await handleInterview(makeRequest({ tripId: 'trip-dev', answer: { text: '음력 설날쯤' } }), deps)
    expect(response.status).toBe(200)
    const body = InterviewResponseSchema.parse(await response.json())
    expect(body.slot).toBe('date')
    expect(body.text.startsWith('다시 여쭤볼게요. ')).toBe(true)
  })

  it('범위 밖 선택은 같은 질문', async () => {
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'transport', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    // applyAnswer 수준: 같은 상태 그대로
    const direct = await applyAnswer(planted, { choiceIndex: 99 }, { callJson: throwingCallJson() })
    expect(direct.state).toBe(planted)
    expect(direct.retryText).toBeUndefined()

    // API 수준: 400이 아니라 같은 질문 다시
    const deps = depsForFlow('scratch', throwingCallJson())
    await deps.interviews.save('trip-dev', planted)
    const response = await handleInterview(makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 99 } }), deps)
    expect(response.status).toBe(200)
    const body = InterviewResponseSchema.parse(await response.json())
    expect(body.slot).toBe('transport')
    expect(body.text).toBe('어떻게 이동하실 거예요?')
  })

  it('같은 답을 같은 questionId로 두 번 보내면 두 번째는 상태 그대로', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    await handleInterview(makeRequest({ tripId: 'trip-dev' }), deps)
    const first = await deps.interviews.get('trip-dev')
    const qid = questionIdFor(first!.cursor)
    const r1 = await handleInterview(makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 1 }, questionId: qid }), deps)
    expect(r1.status).toBe(200)
    const afterFirst = await deps.interviews.get('trip-dev')
    const historyLen = afterFirst!.history.length
    // 같은 질문 표시로 같은 답을 한 번 더 보내면 지금 질문과 다르지 않으니 그대로 적용되지만,
    // 두 번째 호출 때는 이미 커서가 moved — 다른 questionId로 보내면 무시된다
    const stale = await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 1 }, questionId: qid }),
      deps,
    )
    expect(stale.status).toBe(200)
    const staleBody = InterviewResponseSchema.parse(await stale.json())
    const current = currentQuestion(afterFirst!)
    expect(staleBody.text).toBe(current.text)
    expect(staleBody.questionId).toBe(questionIdFor(afterFirst!.cursor))
    const afterSecond = await deps.interviews.get('trip-dev')
    // 상태·history를 건드리지 않았다
    expect(afterSecond!.history.length).toBe(historyLen)
    expect(afterSecond!.cursor).toEqual(afterFirst!.cursor)
  })

  it('done 뒤에는 답을 무시하고 done만 돌려준다', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    const { responses } = await driveToDone('scratch', deps)
    const last = responses[responses.length - 1]!
    expect(last.done).toBe(true)
    const before = await deps.interviews.get('trip-dev')
    const historyLen = before!.history.length
    let saveCalls = 0
    const origSave = deps.saveTravelers
    deps.saveTravelers = async (...args) => {
      saveCalls += 1
      return origSave(...args)
    }
    const response = await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 0 }, questionId: last.questionId }),
      deps,
    )
    expect(response.status).toBe(200)
    const body = InterviewResponseSchema.parse(await response.json())
    expect(body.done).toBe(true)
    expect(body.slot).toBe('done')
    expect(saveCalls).toBe(0)
    const after = await deps.interviews.get('trip-dev')
    expect(after!.history.length).toBe(historyLen)
  })

  it('done에 닿을 때 저장이 한 번 실패하면 500, 다시 보내면 저장됨', async () => {
    const deps = depsForFlow('paste', throwingCallJson())
    // done 바로 전(fix_target)까지 간다
    let answer: InterviewAnswer | undefined
    let questionId: string | undefined
    let beforeDone: InterviewState | null = null
    for (let i = 0; i < 60; i++) {
      const response = await handleInterview(
        makeRequest({ tripId: 'trip-dev', ...(answer === undefined ? {} : { answer, questionId }) }),
        deps,
      )
      const body = InterviewResponseSchema.parse(await response.json())
      if (body.slot === 'fix_target') {
        beforeDone = await deps.interviews.get('trip-dev')
        break
      }
      answer = pickForSlot(body)
      questionId = body.questionId
    }
    expect(beforeDone).not.toBeNull()
    const fixQid = questionIdFor(beforeDone!.cursor)
    let calls = 0
    deps.saveTravelers = async () => {
      calls += 1
      if (calls === 1) throw new Error('DB 잠깐 고장')
    }
    const fail = await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 0 }, questionId: fixQid }),
      deps,
    )
    expect(fail.status).toBe(500)
    // 실패하면 done 상태를 저장하지 않는다 — 커서는 그대로
    const kept = await deps.interviews.get('trip-dev')
    expect(kept!.cursor.slot).toBe('fix_target')
    const ok = await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 0 }, questionId: fixQid }),
      deps,
    )
    expect(ok.status).toBe(200)
    const okBody = InterviewResponseSchema.parse(await ok.json())
    expect(okBody.done).toBe(true)
  })
})

describe('날짜·시간·장소', () => {
  it('이번 주말·다음 주말은 토요일 날짜로', async () => {
    const deps = { callJson: throwingCallJson() }
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'date', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    const friday = new Date(2026, 9, 30) // 금요일
    const thisWeek = await applyAnswer(planted, { choiceIndex: 0 }, deps, friday)
    expect(thisWeek.state.filled.date).toBe('2026-10-31')
    const nextWeek = await applyAnswer(planted, { choiceIndex: 1 }, deps, friday)
    expect(nextWeek.state.filled.date).toBe('2026-11-07')
  })

  it('서울 기준 토요일이면 그날, 일요일이면 그날이 이번 주말', async () => {
    const deps = { callJson: throwingCallJson() }
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'date', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    // 2026-10-31T23:00Z = 서울 11-01(일) 08시
    const sundaySeoul = new Date('2026-10-31T23:00:00Z')
    const out = await applyAnswer(planted, { choiceIndex: 0 }, deps, sundaySeoul)
    expect(out.state.filled.date).toBe('2026-11-01')
  })

  it('지난 날짜를 AI가 주면 연도 +1, 366일 밖이면 다시 묻기', async () => {
    const deps = { callJson: stubCallJson({ date: '2026-03-15' }) }
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'date', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    const out = await applyAnswer(planted, { text: '3월 15일' }, deps, new Date(2026, 9, 30))
    expect(out.state.filled.date).toBe('2027-03-15')
  })

  it('자유 입력 날짜·시간·꼭 갈 곳은 AI로 채움', async () => {
    const dateState = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'date', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    const dated = await applyAnswer(dateState, { text: '11월 첫째 토요일' }, {
      callJson: stubCallJson({ date: '2026-11-07' }),
    })
    expect(dated.state.filled.date).toBe('2026-11-07')

    const timeState: InterviewState = {
      ...dated.state,
      cursor: { slot: 'time', travelerIndex: 0, questionIndex: 0 },
    }
    const timed = await applyAnswer(timeState, { text: '열 시부터 다섯 시까지' }, {
      callJson: stubCallJson({ startTime: '10:00', endTime: '17:00' }),
    })
    expect(timed.state.filled.startTime).toBe('10:00')
    expect(timed.state.filled.endTime).toBe('17:00')

    const mustState: InterviewState = {
      ...timed.state,
      cursor: { slot: 'must_visit', travelerIndex: 0, questionIndex: 0 },
    }
    const must = await applyAnswer(mustState, { text: '한밭수목원 꼭 가고 싶어' }, {
      callJson: stubCallJson({ mustVisit: [{ name: '한밭수목원' }] }),
    })
    expect(must.state.filled.mustVisit).toEqual([{ name: '한밭수목원' }])
  })

  it('13:00~09:00처럼 시작이 끝보다 늦으면 다시 묻기', async () => {
    const deps = { callJson: stubCallJson({ startTime: '13:00', endTime: '09:00' }) }
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [STYLE_FALLBACK],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'time', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    const out = await applyAnswer(planted, { text: '오후 1시부터 아침 9시까지' }, deps)
    expect(out.retryText).toContain('다시 여쭤볼게요')
  })

  it('없어요 계열만 빈 목록, 말이 섞이면 AI로', async () => {
    const counter = { calls: 0 }
    const planted = (mode: StartMode): InterviewState =>
      InterviewStateSchema.parse({
        filled: { mode, travelers: [parentTraveler()], styles: [], mustVisit: [], fixTargets: [] },
        cursor: { slot: 'must_visit', travelerIndex: 0, questionIndex: 0 },
        history: [],
      })
    const empty = await applyAnswer(planted('scratch'), { text: '없어요.' }, { callJson: throwingCallJson(counter) })
    expect(empty.state.filled.mustVisit).toEqual([])
    expect(counter.calls).toBe(0)
    const withWords = await applyAnswer(planted('scratch'), { text: '예약한 곳은 없어요. 대신 한밭수목원은 꼭 가고 싶어요' }, {
      callJson: stubCallJson({ mustVisit: [{ name: '한밭수목원' }] }, counter),
    })
    expect(withWords.state.filled.mustVisit).toEqual([{ name: '한밭수목원' }])
    expect(counter.calls).toBeGreaterThan(0)
  })

  it('스타일은 쉼표 3종을 나누고 최대 10개', async () => {
    const deps = { callJson: throwingCallJson() }
    const planted = InterviewStateSchema.parse({
      filled: {
        mode: 'scratch',
        travelers: [parentTraveler()],
        styles: [],
        mustVisit: [],
        fixTargets: [],
      },
      cursor: { slot: 'styles', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    const out = await applyAnswer(planted, { text: '관광·명소、자연·산책，맛집·음식' }, deps)
    expect(out.state.filled.styles).toEqual(['관광·명소', '자연·산책', '맛집·음식'])
    const many = await applyAnswer(planted, { text: Array.from({ length: 12 }, (_, i) => `취향${i}`).join(',') }, deps)
    expect(many.state.filled.styles.length).toBe(10)
  })
})

const STYLE_FALLBACK = '관광·명소'

describe('모드별 칸', () => {
  it('scratch만 스타일·예산, paste만 고칠 곳', async () => {
    const scratchDeps = depsForFlow('scratch', throwingCallJson())
    const { responses: scratchResponses, seen: scratchSeen } = await driveToDone('scratch', scratchDeps)
    expect(scratchSeen).toContain('styles')
    expect(scratchSeen).toContain('budget')
    expect(scratchSeen).not.toContain('fix_target')
    expect(scratchResponses[scratchResponses.length - 1]!.filled.fixTargets).toEqual([])

    const pasteDeps = depsForFlow('paste', throwingCallJson())
    const { responses: pasteResponses, seen: pasteSeen } = await driveToDone('paste', pasteDeps)
    expect(pasteSeen).toContain('fix_target')
    expect(pasteSeen).not.toContain('styles')
    expect(pasteSeen).not.toContain('budget')
    const pasteLast = pasteResponses[pasteResponses.length - 1]!
    expect(pasteLast.done).toBe(true)
    expect(pasteLast.filled.fixTargets).toEqual(['전체적으로 덜 걷게'])
  })

  it('다른 tripId 상태는 분리된다', async () => {
    const base = createDevDeps()
    const deps: AiDeps = { ...base, callJson: throwingCallJson(), getTripContext: async () => ({ trip: { id: 'trip-dev', groupId: 'g-dev', startMode: 'scratch' as StartMode }, travelers: [], versions: [] }) }
    await handleInterview(makeRequest({ tripId: 'trip-dev' }), deps)
    // trip-dev를 한 칸 앞으로 보낸다
    const devFirst = await deps.interviews.get('trip-dev')
    await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 0 }, questionId: questionIdFor(devFirst!.cursor) }),
      deps,
    )
    const other: AiDeps = {
      ...base,
      callJson: throwingCallJson(),
      requireTripMember: async () => ({ userId: 'u-mom', userName: 'u-mom' }),
      getTripContext: async () => ({ trip: { id: 'trip-other', groupId: 'g-dev', startMode: 'scratch' as StartMode }, travelers: [], versions: [] }),
    }
    // trip-other는 요구 검사를 우회해 직접 저장소를 쓴다
    await other.interviews.save('trip-other', initialState('scratch', []))
    const got = await other.interviews.get('trip-other')
    const dev = await deps.interviews.get('trip-dev')
    expect(got?.cursor).not.toEqual(dev?.cursor)
  })

  it('getTripContext는 상태가 없을 때만 부른다', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    const spy = vi.spyOn(deps, 'getTripContext')
    await handleInterview(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(spy).toHaveBeenCalledTimes(1)
    const stored = await deps.interviews.get('trip-dev')
    await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 1 }, questionId: questionIdFor(stored!.cursor) }),
      deps,
    )
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/ai/interview', () => {
  it('API: 401·403·400', async () => {
    const unauthorized = await POST(makeRequest({ tripId: 'trip-dev' }, null))
    expect(unauthorized.status).toBe(401)

    const forbidden = await POST(makeRequest({ tripId: 'trip-other' }))
    expect(forbidden.status).toBe(403)

    const invalid = await POST(makeRequest({ text: '안녕' }))
    expect(invalid.status).toBe(400)
  })

  it('공백·빈 answer는 400', async () => {
    const blank = await POST(makeRequest({ tripId: 'trip-dev', answer: { text: '   ' } }))
    expect(blank.status).toBe(400)
    const empty = await POST(makeRequest({ tripId: 'trip-dev', answer: {} }))
    expect(empty.status).toBe(400)
  })

  it('401일 때 interviews.get·save가 안 불림', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    const getSpy = vi.spyOn(deps.interviews, 'get')
    const saveSpy = vi.spyOn(deps.interviews, 'save')
    const response = await handleInterview(makeRequest({ tripId: 'trip-dev' }, null), deps)
    expect(response.status).toBe(401)
    expect(getSpy).not.toHaveBeenCalled()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('응답은 InterviewResponseSchema 통과', async () => {
    const deps = depsForFlow('scratch', throwingCallJson())
    const first = await handleInterview(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(first.status).toBe(200)
    InterviewResponseSchema.parse(await first.json())
    const stored = await deps.interviews.get('trip-dev')
    const second = await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { choiceIndex: 1 }, questionId: questionIdFor(stored!.cursor) }),
      deps,
    )
    expect(second.status).toBe(200)
    InterviewResponseSchema.parse(await second.json())
  })

  it('관계 mother면 부모님·여성 (우리 엄마)', async () => {
    const out = await applyAnswer(
      initialState('scratch', []),
      { text: '우리 엄마랑 갈 거야' },
      { callJson: stubCallJson({ travelers: [{ label: '우리 엄마', relation: 'mother' }] }) },
    )
    expect(out.state.filled.travelers[0]).toMatchObject({ label: '우리 엄마', isParent: true, sex: 'female' })
  })

  it('이름표가 부모님이면 관계 self·other여도 부모님·여성', async () => {
    const momSelf = await applyAnswer(
      initialState('scratch', []),
      { text: '엄마랑 갈 거야' },
      { callJson: stubCallJson({ travelers: [{ label: '엄마', relation: 'self' }] }) },
    )
    expect(momSelf.state.filled.travelers[0]).toMatchObject({ label: '엄마', isParent: true, sex: 'female' })
    const grandOther = await applyAnswer(
      initialState('scratch', []),
      { text: '할머니랑 갈 거야' },
      { callJson: stubCallJson({ travelers: [{ label: '할머니', relation: 'other' }] }) },
    )
    expect(grandOther.state.filled.travelers[0]).toMatchObject({
      label: '할머니',
      isParent: true,
      sex: 'female',
    })
  })

  it('callJson에 넘어간 deadlineMs는 25000 이하', async () => {
    const seen: (number | undefined)[] = []
    const deps = depsForFlow(
      'scratch',
      (async (req: { schema: z.ZodType<unknown> }, extra?: { deadlineMs?: number }) => {
        seen.push(extra?.deadlineMs)
        return req.schema.parse({ travelers: [{ label: '엄마', relation: 'self' }] })
      }) as unknown as AiDeps['callJson'],
    )
    await handleInterview(makeRequest({ tripId: 'trip-dev' }), deps, { now: () => 1000 })
    const response = await handleInterview(
      makeRequest({ tripId: 'trip-dev', answer: { text: '엄마랑 갈 거야' } }),
      deps,
      { now: () => 1000 },
    )
    expect(response.status).toBe(200)
    expect(seen.length).toBeGreaterThan(0)
    for (const deadlineMs of seen) {
      expect(deadlineMs).toBeDefined()
      expect(deadlineMs!).toBeLessThanOrEqual(25000)
    }
  })

  it("이미 있는 여행자 '시아버님'은 부모님·남성", async () => {
    const bare: Traveler = {
      id: 't1',
      label: '시아버님',
      pace: 'unknown',
      mobilityAid: false,
      isParent: true,
      condition: {},
      filledBySelf: false,
    }
    let state = initialState('scratch', [bare])
    expect(state.filled.travelers[0]?.sex).toBeUndefined()
    state = (await applyAnswer(state, { choiceIndex: 1 }, { callJson: throwingCallJson() })).state
    expect(state.filled.travelers[0]?.sex).toBe('male')
    expect(state.filled.travelers[0]?.isParent).toBe(true)
  })
})
