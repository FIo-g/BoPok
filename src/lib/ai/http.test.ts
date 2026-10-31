// http.js 공용 도우미 검사. 외부 API를 부르지 않는다.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiErrorSchema, ApiErrorSchema } from '@/lib/contracts'
import type { TripVersion } from '@/lib/contracts'
import { HttpError as AcctHttpError } from '@/lib/auth/http'
import { AiCallError } from './client'
import type { TripContext } from './deps'
import { HttpError, errorResponse, handle, readJson, requireVersionInTrip } from './http'

const Schema = z.object({ tripId: z.string().min(1) })

function jsonRequest(body: string): Request {
  return new Request('https://example.com/api', { method: 'POST', body })
}

describe('readJson', () => {
  it('readJson: 깨진 JSON은 400', async () => {
    await expect(readJson(jsonRequest('{oops'), Schema)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    })
  })

  it('스키마 실패도 400', async () => {
    await expect(readJson(jsonRequest('{}'), Schema)).rejects.toMatchObject({ status: 400 })
  })

  it('맞으면 값을 돌려준다', async () => {
    await expect(readJson(jsonRequest('{"tripId":"t1"}'), Schema)).resolves.toEqual({ tripId: 't1' })
  })
})

describe('errorResponse', () => {
  it('errorResponse: AI 실패는 502 ai_failed와 fallback', async () => {
    const response = errorResponse(new AiCallError('provider_failed', '공급자 호출 실패'))
    expect(response.status).toBe(502)
    const body = AiErrorSchema.parse(await response.json())
    expect(body.error.code).toBe('ai_failed')
    expect(body.error.fallback).toBe('retry_or_pick')
  })

  it('내부 오류 메시지는 숨김', async () => {
    const response = errorResponse(new Error('DB 주소 127.0.0.1 person 테이블 값'))
    expect(response.status).toBe(500)
    const body = ApiErrorSchema.parse(await response.json())
    expect(JSON.stringify(body)).not.toContain('DB 주소')
  })

  it('내부 오류는 500 internal_error이고 원래 메시지가 없음', async () => {
    const response = errorResponse(new Error('DB 주소 127.0.0.1 person 테이블 값'))
    expect(response.status).toBe(500)
    const parsed = (await response.json()) as { error: Record<string, unknown> }
    expect(parsed.error.code).toBe('internal_error')
    expect(JSON.stringify(parsed)).not.toContain('DB 주소')
  })

  it('HttpError는 그 status·code·fallback을 그대로', async () => {
    const response = errorResponse(new HttpError(401, 'unauthorized', '로그인이 필요해요'))
    expect(response.status).toBe(401)
    const parsed = await response.json()
    expect(ApiErrorSchema.parse(parsed).error.code).toBe('unauthorized')
    expect('fallback' in (parsed as Record<string, unknown> as { error: Record<string, unknown> }).error).toBe(false)
  })

  it('HttpError에 fallback이 있으면 담는다', async () => {
    const response = errorResponse(new HttpError(502, 'ai_failed', 'AI 요청이 실패했어요', 'pick_places'))
    const body = AiErrorSchema.parse(await response.json())
    expect(body.error.fallback).toBe('pick_places')
  })

  it('ai_failed가 아닌 코드에 fallback을 줘도 응답에 안 나옴', async () => {
    const response = errorResponse(new HttpError(400, 'invalid_request', '요청 내용이 형식에 맞지 않아요', 'pick_places'))
    expect(response.status).toBe(400)
    const parsed = (await response.json()) as { error: Record<string, unknown> }
    expect('fallback' in parsed.error).toBe(false)
  })
})

describe('김경선(src/lib/auth)의 HttpError', () => {
  it('401·403·404는 500이 아니라 그 상태 코드와 메시지 그대로 나간다', async () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
    ] as const) {
      const response = await handle(async () => {
        throw new AcctHttpError(status, code, '권한 메시지')
      })
      expect(response.status).toBe(status)
      const body = ApiErrorSchema.parse(await response.json())
      expect(body.error).toEqual({ code, message: '권한 메시지' })
    }
  })

  it('AI 쪽 HttpError는 fallback이 그대로 붙는다', async () => {
    const response = await handle(async () => {
      throw new HttpError(502, 'ai_failed', 'AI 요청이 실패했어요', 'pick_places')
    })
    expect(AiErrorSchema.parse(await response.json()).error.fallback).toBe('pick_places')
  })
})

describe('handle', () => {
  it('성공은 값 그대로', async () => {
    const response = await handle(async () => ({ ok: true }))
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('실패는 errorResponse로', async () => {
    const response = await handle(async () => {
      throw new HttpError(403, 'forbidden', '이 여행의 구성원이 아니에요')
    })
    expect(response.status).toBe(403)
  })

  it('AI 실패 fallback이 옵션대로', async () => {
    const response = await handle(
      async () => {
        throw new AiCallError('provider_failed', '공급자 호출 실패')
      },
      { aiFallback: 'pick_places' },
    )
    expect(response.status).toBe(502)
    const body = AiErrorSchema.parse(await response.json())
    expect(body.error.code).toBe('ai_failed')
    expect(body.error.fallback).toBe('pick_places')
  })

  it('AI 실패 fallback 옵션이 없으면 fallback 칸 없음', async () => {
    const response = await handle(async () => {
      throw new AiCallError('provider_failed', '공급자 호출 실패')
    })
    expect(response.status).toBe(502)
    const parsed = (await response.json()) as { error: Record<string, unknown> }
    expect(parsed.error.code).toBe('ai_failed')
    expect('fallback' in parsed.error).toBe(false)
  })
})

const version: TripVersion = {
  id: 'v1',
  tripId: 'trip-dev',
  number: 1,
  parentId: null,
  madeBy: 'ai',
  madeByUserId: null,
  stops: [],
  summary: null,
  note: null,
  createdAt: '2026-10-30T00:00:00.000Z',
}

const tripContext: TripContext = {
  trip: { id: 'trip-dev', groupId: 'g-dev', startMode: 'scratch' },
  travelers: [],
  versions: [version],
}

describe('requireVersionInTrip', () => {
  it('그 여행의 버전이면 돌려준다', () => {
    expect(requireVersionInTrip(tripContext, 'v1')).toEqual(version)
  })

  it('그 여행의 버전이 아니면 404 not_found', () => {
    try {
      requireVersionInTrip(tripContext, 'v-다른그룹')
      expect.unreachable('버전이 없으면 던져야 한다')
    } catch (error) {
      expect(error).toMatchObject({ status: 404, code: 'not_found' })
    }
  })
})
