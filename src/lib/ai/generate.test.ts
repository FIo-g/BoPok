// 처음부터 일정 짜기 검사. AI·외부 API는 가짜 연결 지점으로만 부른다.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AiErrorSchema,
  ApiErrorSchema,
  PlanResponseSchema,
  type InterviewFilled,
  type InterviewState,
} from '@/lib/contracts'
import { POST } from '@/app/api/ai/generate/route'
import { AiCallError } from './client'
import { createDevDeps } from './dev-deps'
import type { AiDeps, CandidateQuery } from './deps'
import { handleGenerate } from './generate'

function makeRequest(body: unknown, userId: string | null = 'u-mom'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (userId !== null) headers['x-dev-user'] = userId
  return new Request('https://example.com/api/ai/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function doneState(overrides?: Partial<InterviewFilled>): InterviewState {
  return {
    filled: {
      mode: 'scratch',
      travelers: [],
      styles: [],
      mustVisit: [],
      fixTargets: [],
      ...overrides,
    },
    cursor: { slot: 'done', travelerIndex: 0, questionIndex: 0 },
    history: [],
  }
}

// AI가 돌려줄 stops 모양 그대로 — 가짜 callJson은 스키마로 검사해 돌려준다.
type AiPayload = {
  stops: {
    placeId: string | null
    name: string
    startTime?: string
    visitMin?: number
    seated?: boolean
  }[]
  note?: string
}

function depsWithAi(responses: (AiPayload | Error)[]): { deps: AiDeps; calls: string[] } {
  const deps = createDevDeps()
  const calls: string[] = []
  let index = 0
  return {
    deps: {
      ...deps,
      callJson: (async (req: { messages: { content: string }[]; schema: z.ZodType<unknown> }) => {
        calls.push(req.messages.map(message => message.content).join('\n'))
        const next = responses[Math.min(index, responses.length - 1)]
        index += 1
        if (next instanceof Error) throw next
        return req.schema.parse(next)
      }) as unknown as AiDeps['callJson'],
    },
    calls,
  }
}

describe('handleGenerate', () => {
  it('후보 밖 id는 버림', async () => {
    const { deps } = depsWithAi([
      {
        stops: [
          { placeId: 'science', name: '국립중앙과학관' },
          { placeId: 'no-such-place', name: '없는 곳' },
          { placeId: null, name: '점심', seated: true },
        ],
        note: '덜 걷는 일정',
      },
    ])
    await deps.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())

    // 목록 밖 id는 버리고 식사 자리(null)는 둔다
    expect(body.version.stops.map(stop => stop.placeId)).toEqual(['science', null])
    expect(body.version.stops.map(stop => stop.name)).toEqual(['국립중앙과학관', '점심'])
    expect(body.version.note).toBe('덜 걷는 일정')
  })

  it('꼭 갈 곳은 빠져도 넣음', async () => {
    const { deps } = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    await deps.interviews.save(
      'trip-dev',
      doneState({ transport: 'car', mustVisit: [{ name: '한밭수목원', reservedAt: '14:00' }] }),
    )

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())

    const hanbat = body.version.stops.find(stop => stop.placeId === 'hanbat')
    expect(hanbat).toBeDefined()
    expect(hanbat).toMatchObject({ mustVisit: true, reservedAt: '14:00' })
  })

  it('조정 필요면 한 번 더 묻고 저장', async () => {
    const { deps, calls } = depsWithAi([
      { stops: [{ placeId: 'hanbat', name: '한밭수목원' }] },
      { stops: [{ placeId: 'science', name: '국립중앙과학관' }] },
    ])
    await deps.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())

    // 계단 위반(adjust)이라 한 번 더 묻는다. 두 번째 요청에는 엔진 문장이 그대로 들어간다
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('한밭수목원 안에 계단 구간이 있어요')
    expect(calls[1]).toContain('덜 걷게 다시 골라라')
    expect(body.version.stops.map(stop => stop.placeId)).toEqual(['science'])
    expect(body.summary.verdict).not.toBe('adjust')
  })

  it('madeBy ai로 저장', async () => {
    const { deps } = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    await deps.interviews.save('trip-dev', doneState({}))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.madeBy).toBe('ai')
  })

  it('부모 버전은 가장 최근 버전', async () => {
    const { deps } = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    await deps.interviews.save('trip-dev', doneState({}))
    const first = await deps.createVersion('trip-dev', { parentId: null, stops: [], madeBy: 'ai' })

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.parentId).toBe(first.id)
  })

  it('대중교통이면 버스 후보로 찾는다', async () => {
    const base = createDevDeps()
    const queries: CandidateQuery[] = []
    const { deps, calls } = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    const spied: AiDeps = {
      ...deps,
      searchCandidates: (async (q: CandidateQuery) => {
        queries.push(q)
        return base.searchCandidates(q)
      }) as AiDeps['searchCandidates'],
    }
    await spied.interviews.save('trip-dev', doneState({ transport: 'transit' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), spied)
    expect(response.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0].transport).toBe('bus')
    expect(calls).toHaveLength(1)
    // 대중교통 첫 장소는 정류장에서 내리므로 bus다
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.stops[0].arriveBy).toBe('bus')
  })

  it('인터뷰 전이면 400', async () => {
    const { deps } = depsWithAi([{ stops: [] }])

    // 상태 자체가 없음
    const missing = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(missing.status).toBe(400)
    expect(ApiErrorSchema.parse(await missing.json()).error.code).toBe('invalid_request')

    // done 전 커서도 안 됨
    await deps.interviews.save(
      'trip-dev',
      doneState({ transport: 'car', styles: ['자연·산책'] }),
    )
    const notDone = await deps.interviews.get('trip-dev')
    await deps.interviews.save('trip-dev', {
      ...notDone!,
      cursor: { slot: 'styles', travelerIndex: 0, questionIndex: 0 },
    })
    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(400)
    const body = ApiErrorSchema.parse(await response.json())
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toContain('인터뷰를 먼저 마쳐 주세요')
  })

  it('AI 실패면 502 retry_or_pick', async () => {
    const { deps } = depsWithAi([new AiCallError('provider_failed', '공급자 호출 실패')])
    await deps.interviews.save('trip-dev', doneState({}))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(502)
    const body = AiErrorSchema.parse(await response.json())
    expect(body.error.code).toBe('ai_failed')
    expect(body.error.fallback).toBe('retry_or_pick')
  })

  it('응답 PlanResponseSchema 통과', async () => {
    const { deps } = depsWithAi([
      {
        stops: [
          { placeId: 'science', name: '국립중앙과학관' },
          { placeId: 'museum', name: '대전시립미술관' },
        ],
      },
    ])
    await deps.interviews.save(
      'trip-dev',
      doneState({ transport: 'car', startTime: '09:00', endTime: '18:00' }),
    )

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    expect(PlanResponseSchema.parse(await response.json())).toBeTruthy()
  })

  it('장소 요약은 후보 목록에 그대로 들어간다', async () => {
    const { deps, calls } = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    await deps.interviews.save('trip-dev', doneState({}))

    await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(calls).toHaveLength(1)
    // AI가 숫자를 지어내지 않게 후보 목록만 주고 걷는 시간 계산은 시키지 않는다
    expect(calls[0]).toContain('국립중앙과학관')
    expect(calls[0]).toContain('이 목록의 id로만 골라라')
    expect(calls[0]).toContain('걷는 시간·거리·계단 수는 쓰지 마라')
  })

  it('이름은 DB 이름으로, note에 숫자 → note 없음', async () => {
    const { deps } = depsWithAi([
      {
        stops: [{ placeId: 'science', name: '엉뚱한 이름' }],
        note: '30분 코스',
      },
    ])
    await deps.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.stops[0].name).toBe('국립중앙과학관')
    expect(body.version.note).toBeNull()
  })

  it('null id인데 seated 아님 → 버림', async () => {
    const { deps } = depsWithAi([
      {
        stops: [
          { placeId: 'science', name: '국립중앙과학관' },
          { placeId: null, name: '점심' },
          { placeId: null, name: '숫자 3곳', seated: true },
        ],
      },
    ])
    await deps.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.stops.map(stop => stop.placeId)).toEqual(['science'])
  })

  it('연달아 같은 id → 하나', async () => {
    const { deps } = depsWithAi([
      {
        stops: [
          { placeId: 'science', name: '국립중앙과학관' },
          { placeId: 'science', name: '국립중앙과학관' },
          { placeId: 'hanbat', name: '한밭수목원' },
          { placeId: 'hanbat', name: '한밭수목원' },
        ],
      },
    ])
    await deps.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())
    // 두 번째 호출(adjust 재시도)까지 합치면 호출이 2번일 수 있으므로 첫 저장 결과만 본다
    expect(body.version.stops.map(stop => stop.placeId)).toEqual(['science', 'hanbat'])
  })

  it('꼭 갈 곳 성심당(12:00)·AI 성심당 본점 → 하나로 합쳐지고 시간 순서 자리', async () => {
    const ssd = {
      id: 'ssd',
      name: '성심당 본점',
      category: '빵집',
      styles: ['맛집·음식'],
      coord: [127.38, 36.35] as [number, number],
      visitMin: 30,
      seated: false,
      indoor: true,
      source: '테스트',
      checkedAt: '2026-10-30',
      confidence: 'C' as const,
    }
    const base = depsWithAi([
      {
        stops: [
          { placeId: 'science', name: '국립중앙과학관', startTime: '10:00' },
          { placeId: 'museum', name: '대전시립미술관', startTime: '15:00' },
        ],
      },
    ])
    const deps = {
      ...base.deps,
      searchCandidates: (async () => {
        const dev = createDevDeps()
        const list = await dev.searchCandidates({ styles: [], transport: 'car', avoidStairs: true, limit: 30 })
        return [...list, ssd]
      }) as AiDeps['searchCandidates'],
      matchPlaceByName: (async (name: string) => {
        if (name.includes('성심당')) return ssd
        return createDevDeps().matchPlaceByName(name)
      }) as AiDeps['matchPlaceByName'],
      getPlaceDetails: (async (ids: string[]) => {
        const dev = createDevDeps()
        const details = await dev.getPlaceDetails(ids)
        return details
      }) as AiDeps['getPlaceDetails'],
    }
    await deps.interviews.save(
      'trip-dev',
      doneState({ transport: 'car', mustVisit: [{ name: '성심당', reservedAt: '12:00' }] }),
    )

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())
    const found = body.version.stops.filter(stop => stop.placeId === 'ssd')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ mustVisit: true, reservedAt: '12:00', startTime: '12:00' })
    // 10시와 15시 사이에 들어가야 한다
    const times = body.version.stops.map(stop => stop.startTime ?? '')
    const ssdIndex = body.version.stops.findIndex(stop => stop.placeId === 'ssd')
    expect(times[ssdIndex]).toBe('12:00')
    expect(ssdIndex).toBe(1)
  })

  it('첫 AI가 전부 후보 밖 → 502 retry_or_pick', async () => {
    const { deps } = depsWithAi([{ stops: [{ placeId: 'nope', name: '없는 곳' }] }])
    await deps.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), deps)
    expect(response.status).toBe(502)
    expect(AiErrorSchema.parse(await response.json()).error.fallback).toBe('retry_or_pick')
  })

  it('여행자 0명 400', async () => {
    const { deps } = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    const withNoTravelers: AiDeps = {
      ...deps,
      getTripContext: (async (tripId: string) => {
        const ctx = await deps.getTripContext(tripId)
        return { ...ctx, travelers: [] }
      }) as AiDeps['getTripContext'],
    }
    await withNoTravelers.interviews.save('trip-dev', doneState({ transport: 'car' }))

    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), withNoTravelers)
    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('함께 가는 분 정보')
  })

  it('paste 모드 바탕 없으면 400, 있으면 parentId가 바탕', async () => {
    const first = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    await first.deps.interviews.save('trip-dev', doneState({ mode: 'paste', transport: 'car' }))

    const missing = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), first.deps)
    expect(missing.status).toBe(400)
    expect((await missing.json()).error.message).toContain('붙여 넣은 일정')

    const second = depsWithAi([{ stops: [{ placeId: 'science', name: '국립중앙과학관' }] }])
    await second.deps.interviews.save(
      'trip-dev',
      doneState({ mode: 'paste', transport: 'car', fixTargets: ['전체적으로 덜 걷게'] }),
    )
    const base = await second.deps.createVersion('trip-dev', { parentId: null, stops: [], madeBy: 'ai' })
    const response = await handleGenerate(makeRequest({ tripId: 'trip-dev' }), second.deps)
    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.parentId).toBe(base.id)
  })
})

describe('POST /api/ai/generate', () => {
  it('API 401·403', async () => {
    const unauthorized = await POST(makeRequest({ tripId: 'trip-dev' }, null))
    expect(unauthorized.status).toBe(401)

    const forbidden = await POST(makeRequest({ tripId: 'trip-other' }))
    expect(forbidden.status).toBe(403)
  })

  it('API 400 (요청 형식·인터뷰 전)', async () => {
    const invalid = await POST(makeRequest({}))
    expect(invalid.status).toBe(400)

    // 실제 dev-deps에는 인터뷰 상태가 없으므로 400이다
    const noInterview = await POST(makeRequest({ tripId: 'trip-dev' }))
    expect(noInterview.status).toBe(400)
  })
})
