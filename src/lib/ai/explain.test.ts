// 바뀐 점 한 줄 검사. AI·외부 API는 가짜 연결 지점으로만 부른다.
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ApiErrorSchema,
  ExplainResponseSchema,
  type JudgeResult,
  type QuickFixChange,
  type Stop,
  type Traveler,
} from '@/lib/contracts'
import { judge, quickFixes } from '@/lib/engine'
import { diffSummary, fixedChangeSentence, formatDiffItem } from '@/lib/engine/diff'
import { places } from '@/lib/engine/test-fixtures'
import { AiCallError } from './client'
import { createDevDeps } from './dev-deps'
import type { AiDeps } from './deps'
import { explainChange, handleExplain, numbersIn } from './explain'

const mom: Traveler = {
  id: 't1',
  label: '엄마',
  isParent: true,
  pace: 'normal',
  mobilityAid: false,
  condition: {},
  filledBySelf: true,
}

function makeStop(key: string, placeId: string | null, over: Partial<Stop> = {}): Stop {
  const place = placeId ? places[placeId] : undefined
  return {
    key,
    placeId,
    name: place?.name ?? '점심',
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...over,
  }
}

// 노션 4-2 예시: 원래 일정(adjust) → B 수정안(ok). diff에 숫자가 들어 있어 AI 숫자 검사를 시험할 수 있다.
function pair(): { prev: JudgeResult; next: JudgeResult } {
  const prev = judge({
    travelers: [mom],
    tuned: { continuousMin: 23 },
    stops: [makeStop('k1', 'hanbat')],
    places,
    legs: {},
  })
  const fixes = quickFixes({
    travelers: [mom],
    tuned: { continuousMin: 23 },
    stops: [makeStop('k1', 'hanbat')],
    places,
    legs: {},
  })
  const found = fixes.find(fix => fix.level === 'B')
  if (found === undefined) throw new Error('B 수정안이 있어야 해요')
  return { prev, next: found.result }
}

function depsWithAi(response: { text: string } | Error): AiDeps {
  const deps = createDevDeps()
  return {
    ...deps,
    callJson: (async (req: { schema: z.ZodType<unknown> }) => {
      if (response instanceof Error) throw response
      return req.schema.parse(response)
    }) as unknown as AiDeps['callJson'],
  }
}

function makeRequest(body: unknown, userId: string | null = 'u-mom'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (userId !== null) headers['x-dev-user'] = userId
  return new Request('https://example.com/api/ai/explain', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('numbersIn', () => {
  it('숫자만 뽑는다', () => {
    expect(numbersIn('약 15~20분')).toEqual(['15', '20'])
    expect(numbersIn('바뀐 점 없음')).toEqual([])
  })
})

describe('explainChange', () => {
  it('입력 구절을 그대로 쓰면 ai', async () => {
    const { prev, next } = pair()
    const lines = diffSummary(prev, next).map(formatDiffItem)
    const rangePhrase = lines.join(', ').match(/약 \p{Nd}+~\p{Nd}+분/u)?.[0]
    expect(rangePhrase).toBeDefined()

    const text = `${rangePhrase}으로 바뀌었어요`
    expect(Array.from(text).length).toBeLessThanOrEqual(60)
    const out = await explainChange(prev, next, undefined, depsWithAi({ text }))
    expect(out).toEqual({ text, source: 'ai' })
  })

  it('약 28~34분 → 약 19~23분 입력이면 구절 그대로만 ai', async () => {
    const { prev } = pair()
    const customPrev = { ...prev, longest: { base: 28, high: 34, fromStopKey: 'k1', toStopKey: 'k1' } }
    const customNext = { ...prev, longest: { base: 19, high: 23, fromStopKey: 'k1', toStopKey: 'k1' } }
    const lines = diffSummary(customPrev, customNext).map(formatDiffItem)
    expect(lines.join(', ')).toContain('약 28~34분')
    expect(lines.join(', ')).toContain('약 19~23분')

    const fixed1 = await explainChange(customPrev, customNext, undefined, depsWithAi({ text: '연속 걷기가 3분 줄어요' }))
    expect(fixed1.source).toBe('fixed')
    const fixed2 = await explainChange(customPrev, customNext, undefined, depsWithAi({ text: '약 8~34분에서 줄었어요' }))
    expect(fixed2.source).toBe('fixed')
    const fixed3 = await explainChange(customPrev, customNext, undefined, depsWithAi({ text: '계단을 모두 없앴어요' }))
    expect(fixed3.source).toBe('fixed')
    const ai = await explainChange(
      customPrev,
      customNext,
      undefined,
      depsWithAi({ text: '약 28~34분에서 약 19~23분으로 줄어요' }),
    )
    expect(ai).toEqual({ text: '약 28~34분에서 약 19~23분으로 줄어요', source: 'ai' })
  })

  it('없는 숫자를 쓰면 고정 문장', async () => {
    const { prev, next } = pair()
    const lines = diffSummary(prev, next).map(formatDiffItem)
    expect(numbersIn(lines.join(', '))).not.toContain('999')

    const out = await explainChange(prev, next, undefined, depsWithAi({ text: '걷기가 999분으로 줄었어요' }))
    expect(out.source).toBe('fixed')
    expect(out.text).toBe(lines.join(', ') || '바뀐 점 없음')
  })

  it('너무 길면 고정 문장', async () => {
    const { prev, next } = pair()
    const out = await explainChange(prev, next, undefined, depsWithAi({ text: '가'.repeat(61) }))
    expect(out.source).toBe('fixed')
  })

  it('AI 실패면 고정 문장', async () => {
    const { prev, next } = pair()
    const deps = depsWithAi(new AiCallError('provider_failed', '공급자 호출 실패'))
    const out = await explainChange(prev, next, undefined, deps)
    expect(out.source).toBe('fixed')
    expect(out.text).toBe(diffSummary(prev, next).map(formatDiffItem).join(', ') || '바뀐 점 없음')
  })

  it('변경 목록이 있으면 그 고정 문장', async () => {
    const { prev, next } = pair()
    const changes: QuickFixChange[] = [
      { kind: 'detour', stopKey: 'k1', segmentId: 's3', detourSegmentId: 's3d' },
    ]
    const deps = depsWithAi(new AiCallError('provider_failed', '공급자 호출 실패'))
    const out = await explainChange(prev, next, changes, deps)
    expect(out).toEqual({ text: fixedChangeSentence(changes), source: 'fixed' })
  })

  it('AI 실패해도 502가 아니라 고정 문장으로 200', async () => {
    const { prev, next } = pair()
    const deps = depsWithAi(new AiCallError('provider_failed', '공급자 호출 실패'))
    const response = await handleExplain(makeRequest({ tripId: 'trip-dev', prev, next }), deps)
    expect(response.status).toBe(200)
    const body = ExplainResponseSchema.parse(await response.json())
    expect(body.source).toBe('fixed')
  })

  it('바뀐 점이 없으면 AI를 부르지 않고 고정 문장', async () => {
    const { prev } = pair()
    const calls: string[] = []
    const deps = createDevDeps()
    const spied: AiDeps = {
      ...deps,
      callJson: (async (req: { messages: { content: string }[]; schema: z.ZodType<unknown> }) => {
        calls.push(req.messages.map(message => message.content).join('\n'))
        return req.schema.parse({ text: 'AI가 나서면 안 된다' })
      }) as unknown as AiDeps['callJson'],
    }
    const out = await explainChange(prev, prev, undefined, spied)
    expect(calls).toHaveLength(0)
    expect(out).toEqual({ text: '바뀐 점 없음', source: 'fixed' })
  })

  it('빈 문장·공백이면 고정 문장', async () => {
    const { prev, next } = pair()
    for (const text of ['', '   ']) {
      const out = await explainChange(prev, next, undefined, depsWithAi({ text }))
      expect(out.source).toBe('fixed')
      expect(out.text).toBe(diffSummary(prev, next).map(formatDiffItem).join(', ') || '바뀐 점 없음')
    }
  })

  it('한글 수사 + 단위가 있으면 고정 문장', async () => {
    const { prev, next } = pair()
    for (const text of ['이십칠 분 줄었어요', '열 분 줄었어요']) {
      const out = await explainChange(prev, next, undefined, depsWithAi({ text }))
      expect(out.source).toBe('fixed')
    }
  })

  it('전각 숫자는 입력에 없는 구절이라 고정 문장', async () => {
    const { prev, next } = pair()
    const out = await explainChange(prev, next, undefined, depsWithAi({ text: '２７분 줄었어요' }))
    expect(out.source).toBe('fixed')
  })

  it('범위를 한 점으로 쓰면 고정, 구절 그대로면 ai', async () => {
    const { prev, next } = pair()
    const lines = diffSummary(prev, next).map(formatDiffItem)
    const rangePhrase = lines.join(', ').match(/약 (\p{Nd}+)~\p{Nd}+분/u)
    expect(rangePhrase?.[1]).toBeDefined()
    const single = rangePhrase![1]!

    const fixed = await explainChange(prev, next, undefined, depsWithAi({ text: `걷기가 ${single}분으로 줄었어요` }))
    expect(fixed.source).toBe('fixed')

    const full = rangePhrase![0]!
    const ai = await explainChange(
      prev,
      next,
      undefined,
      depsWithAi({ text: `${full}으로 늘었어요` }),
    )
    expect(ai).toEqual({ text: `${full}으로 늘었어요`, source: 'ai' })
  })

  it('정확히 60자는 ai, 61자는 고정 문장', async () => {
    const { prev, next } = pair()
    const ai = await explainChange(prev, next, undefined, depsWithAi({ text: '가'.repeat(60) }))
    expect(ai).toEqual({ text: '가'.repeat(60), source: 'ai' })
    const fixed = await explainChange(prev, next, undefined, depsWithAi({ text: '가'.repeat(61) }))
    expect(fixed.source).toBe('fixed')
  })

  it('계단이 없다는 표현이면 고정 문장', async () => {
    const { prev, next } = pair()
    for (const text of ['계단이 없어졌어요', '계단 없이 편해졌어요']) {
      const out = await explainChange(prev, next, undefined, depsWithAi({ text }))
      expect(out.source).toBe('fixed')
    }
  })

  it('callJson에 넘어간 deadlineMs는 15000 이하', async () => {
    const { prev, next } = pair()
    const seen: (number | undefined)[] = []
    const base = createDevDeps()
    const deps: AiDeps = {
      ...base,
      callJson: (async (req: { schema: z.ZodType<unknown> }, extra?: { deadlineMs?: number }) => {
        seen.push(extra?.deadlineMs)
        return req.schema.parse({ text: '가'.repeat(10) })
      }) as unknown as AiDeps['callJson'],
    }
    const response = await handleExplain(makeRequest({ tripId: 'trip-dev', prev, next }), deps, {
      now: () => 1000,
    })
    expect(response.status).toBe(200)
    expect(seen.length).toBeGreaterThan(0)
    for (const deadlineMs of seen) {
      expect(deadlineMs).toBeDefined()
      expect(deadlineMs!).toBeLessThanOrEqual(15000)
    }
  })
})

// 라우트(POST)는 실제 연결(real-deps)을 쓰므로, 같은 처리를 하는 handler에 개발용 가짜를 넣어 검사한다.
// 라우트가 handler와 real-deps를 제대로 잇는지는 routes.test.ts가 본다.
describe('POST /api/ai/explain 와 같은 처리 (개발용 가짜 연결)', () => {
  const POST = (request: Request) => handleExplain(request, createDevDeps())

  it('API 401·403', async () => {
    const { prev, next } = pair()
    const unauthorized = await POST(makeRequest({ tripId: 'trip-dev', prev, next }, null))
    expect(unauthorized.status).toBe(401)

    const forbidden = await POST(makeRequest({ tripId: 'trip-other', prev, next }))
    expect(forbidden.status).toBe(403)
  })

  it('API 400', async () => {
    const invalid = await POST(makeRequest({}))
    expect(invalid.status).toBe(400)
    expect(ApiErrorSchema.parse(await invalid.json()).error.code).toBe('invalid_request')
  })

  it('키 없이도 고정 문장으로 200 (AI 실패는 502가 아님)', async () => {
    vi.stubEnv('UPSTAGE_API_KEY', '')
    vi.stubEnv('OPENCODE_API_KEY', '')
    const { prev, next } = pair()
    const response = await POST(makeRequest({ tripId: 'trip-dev', prev, next }))
    expect(response.status).toBe(200)
    const body = ExplainResponseSchema.parse(await response.json())
    expect(body.source).toBe('fixed')
  })

  it('changes가 51개 이상이면 400', async () => {
    vi.stubEnv('UPSTAGE_API_KEY', '')
    vi.stubEnv('OPENCODE_API_KEY', '')
    const { prev, next } = pair()
    const changes = Array.from({ length: 51 }, () => ({ kind: 'taxi', toStopKey: 'k2' }))
    const tooMany = await POST(makeRequest({ tripId: 'trip-dev', prev, next, changes }))
    expect(tooMany.status).toBe(400)
    expect(ApiErrorSchema.parse(await tooMany.json()).error.code).toBe('invalid_request')

    const fifty = Array.from({ length: 50 }, () => ({ kind: 'taxi', toStopKey: 'k2' }))
    const ok = await POST(makeRequest({ tripId: 'trip-dev', prev, next, changes: fifty }))
    expect(ok.status).toBe(200)
  })
})
