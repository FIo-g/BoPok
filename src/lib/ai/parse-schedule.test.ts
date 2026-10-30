// 붙여넣은 일정 정리 API 검사. AI는 가짜 callJson으로만 부른다.
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  AiErrorSchema,
  ParseScheduleResponseSchema,
  type InterviewState,
} from '@/lib/contracts'
import { POST } from '@/app/api/ai/parse-schedule/route'
import { AiCallError } from './client'
import { createDevDeps } from './dev-deps'
import type { AiDeps } from './deps'
import { handleParseSchedule } from './parse-schedule'

function makeRequest(body: unknown, userId: string | null = 'u-mom'): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (userId !== null) headers['x-dev-user'] = userId
  return new Request('https://example.com/api/ai/parse-schedule', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function depsWithCallJson(items: unknown[], error?: Error): AiDeps {
  const deps = createDevDeps()
  return {
    ...deps,
    callJson: (async (req: { schema: z.ZodType<unknown> }) => {
      if (error) throw error
      const result = req.schema.safeParse({ items })
      if (!result.success) throw new AiCallError('invalid_output', '형식에 맞지 않음')
      return result.data
    }) as unknown as AiDeps['callJson'],
  }
}

async function pastedState(transport: 'car' | 'transit' | 'taxi'): Promise<InterviewState> {
  return {
    filled: {
      mode: 'paste',
      travelers: [],
      transport,
      styles: [],
      mustVisit: [],
      fixTargets: [],
    },
    cursor: { slot: 'done', travelerIndex: 0, questionIndex: 0 },
    history: [],
  }
}

describe('handleParseSchedule', () => {
  it('parse: 장소 DB에 있으면 placeId, 없으면 좌표만·unmatched', async () => {
    const deps = depsWithCallJson([
      { name: '한밭수목원', startTime: '10:00' },
      { name: '어딘가식당', seated: true, reservedAt: '12:00' },
    ])
    await deps.interviews.save('trip-dev', await pastedState('transit'))
    const text = '10시 한밭수목원, 12시 어딘가식당'

    const response = await handleParseSchedule(makeRequest({ tripId: 'trip-dev', text }), deps)
    expect(response.status).toBe(200)
    const body = ParseScheduleResponseSchema.parse(await response.json())

    expect(body.stops).toHaveLength(2)
    expect(body.stops[0]).toMatchObject({
      key: 's1',
      placeId: 'hanbat',
      name: '한밭수목원',
      startTime: '10:00',
      arriveBy: 'bus',
    })
    expect(body.stops[1].placeId).toBeNull()
    expect(body.stops[1].coord).toBeDefined()
    expect(body.stops[1].seated).toBe(true)
    expect(body.stops[1].reservedAt).toBe('12:00')
    expect(body.unmatched).toEqual(['어딘가식당'])

    // 원문은 인터뷰 상태에 남겨 둔다 (나중에 다시 정리할 수 있게)
    const saved = await deps.interviews.get('trip-dev')
    expect(saved?.filled.pastedText).toBe(text)
  })

  it('AI 실패면 502 pick_places', async () => {
    const deps = depsWithCallJson([], new AiCallError('provider_failed', '공급자 호출 실패'))
    await deps.interviews.save('trip-dev', await pastedState('car'))

    const response = await handleParseSchedule(
      makeRequest({ tripId: 'trip-dev', text: '10시 한밭수목원' }),
      deps,
    )
    expect(response.status).toBe(502)
    const body = AiErrorSchema.parse(await response.json())
    expect(body.error.code).toBe('ai_failed')
    expect(body.error.fallback).toBe('pick_places')
  })

  it('상태 없음 → 시작 상태로 pastedText 저장', async () => {
    const deps = depsWithCallJson([{ name: '한밭수목원' }])
    // 인터뷰 상태를 저장하지 않는다
    const text = '10시 한밭수목원'

    const response = await handleParseSchedule(makeRequest({ tripId: 'trip-dev', text }), deps)
    expect(response.status).toBe(200)
    const saved = await deps.interviews.get('trip-dev')
    expect(saved?.filled.pastedText).toBe(text)
    expect(saved?.filled.mode).toBe('scratch')
  })

  it('searchPoi null → unmatched', async () => {
    const deps = depsWithCallJson([{ name: '없는곳' }])
    const noPoi: AiDeps = {
      ...deps,
      searchPoi: (async () => null) as AiDeps['searchPoi'],
    }
    await noPoi.interviews.save('trip-dev', await pastedState('car'))

    const response = await handleParseSchedule(
      makeRequest({ tripId: 'trip-dev', text: '없는곳' }),
      noPoi,
    )
    expect(response.status).toBe(200)
    const body = ParseScheduleResponseSchema.parse(await response.json())
    expect(body.stops[0].placeId).toBeNull()
    expect(body.stops[0].coord).toBeUndefined()
    expect(body.unmatched).toEqual(['없는곳'])
  })

  it('빈 items → 502 pick_places', async () => {
    const deps = depsWithCallJson([])
    await deps.interviews.save('trip-dev', await pastedState('car'))

    const response = await handleParseSchedule(
      makeRequest({ tripId: 'trip-dev', text: '10시 한밭수목원' }),
      deps,
    )
    expect(response.status).toBe(502)
    expect(AiErrorSchema.parse(await response.json()).error.fallback).toBe('pick_places')
  })

  it('12시 같은 시간 → 그 칸만 버림', async () => {
    const deps = depsWithCallJson([{ name: '한밭수목원', startTime: '12시', reservedAt: '25:00' }])
    await deps.interviews.save('trip-dev', await pastedState('car'))

    const response = await handleParseSchedule(
      makeRequest({ tripId: 'trip-dev', text: '한밭수목원' }),
      deps,
    )
    expect(response.status).toBe(200)
    const body = ParseScheduleResponseSchema.parse(await response.json())
    expect(body.stops[0].startTime).toBeUndefined()
    expect(body.stops[0].reservedAt).toBeUndefined()
    expect(body.stops[0].placeId).toBe('hanbat')
  })

  it('조회 실패해도 unmatched로 200', async () => {
    const deps = depsWithCallJson([{ name: '어딘가' }])
    const failing: AiDeps = {
      ...deps,
      matchPlaceByName: (async () => {
        throw new Error('DB 실패')
      }) as AiDeps['matchPlaceByName'],
      searchPoi: (async () => {
        throw new Error('POI 실패')
      }) as AiDeps['searchPoi'],
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await failing.interviews.save('trip-dev', await pastedState('car'))
      const response = await handleParseSchedule(
        makeRequest({ tripId: 'trip-dev', text: '어딘가' }),
        failing,
      )
      expect(response.status).toBe(200)
      const body = ParseScheduleResponseSchema.parse(await response.json())
      expect(body.stops[0].placeId).toBeNull()
      expect(body.stops[0].coord).toBeUndefined()
      expect(body.unmatched).toEqual(['어딘가'])
      expect(errorSpy).toHaveBeenCalledWith('[ai]', '장소 조회 실패', expect.anything())
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('POST /api/ai/parse-schedule', () => {
  it('API 401·403·400', async () => {
    const body = { tripId: 'trip-dev', text: '10시 한밭수목원' }

    const unauthorized = await POST(makeRequest(body, null))
    expect(unauthorized.status).toBe(401)

    const forbidden = await POST(makeRequest({ ...body, tripId: 'trip-other' }))
    expect(forbidden.status).toBe(403)

    const invalid = await POST(makeRequest({ text: '10시 한밭수목원' }))
    expect(invalid.status).toBe(400)
  })
})
