import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InviteSchema, type TravelerHealthInput } from '@/lib/contracts'
import { ApiRequestError, request } from './http'
import { realApi } from './real'

// 실제 서버 호출 층: fetch 를 가짜로 바꿔 경로·본문·에러 처리·응답 검사를 확인한다 (서버 없이)
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('request', () => {
  it('응답을 스키마로 검사해 돌려준다', async () => {
    stubFetch(200, { a: 1 })
    expect(await request('/api/x', { schema: z.object({ a: z.number() }) })).toEqual({ a: 1 })
  })

  it('모양이 다른 응답은 에러로 막는다', async () => {
    stubFetch(200, { a: 'x' })
    await expect(request('/api/x', { schema: z.object({ a: z.number() }) })).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('서버 에러 응답의 코드·메시지·AI 대체 동작을 그대로 담는다', async () => {
    stubFetch(502, { error: { code: 'ai_failed', message: 'AI가 안 돼요', fallback: 'retry_or_pick' } })
    const error = await request('/api/ai/generate', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 502, code: 'ai_failed', message: 'AI가 안 돼요', fallback: 'retry_or_pick' })
  })

  it('본문이 없는 에러는 상태 코드로 코드를 정한다', async () => {
    stubFetch(403, undefined)
    await expect(request('/api/groups/g')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    stubFetch(410, undefined)
    await expect(request('/api/invites/t')).rejects.toMatchObject({ status: 410, code: 'expired' })
  })

  it('연결이 안 되면 쉬운 말로 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    await expect(request('/api/x')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('연결') })
  })
})

describe('realApi 경로', () => {
  it('설계 문서의 API 경로와 방법으로 부른다', async () => {
    const fn = stubFetch(200, { token: 't', groupId: 'g', expiresAt: '2099-01-01T00:00:00Z' })
    const invite = await realApi.groups.createInvite('g 1')
    expect(InviteSchema.parse(invite).token).toBe('t')
    expect(fn).toHaveBeenCalledWith('/api/groups/g%201/invites', expect.objectContaining({ method: 'POST' }))
  })

  it('장소 목록은 검색어와 스타일을 쿼리로 보낸다', async () => {
    const fn = stubFetch(200, [])
    await realApi.places.list({ q: '수목원', styles: ['자연·산책', '휴식·힐링'] })
    const [url] = fn.mock.calls[0] as unknown as [string]
    expect(url).toBe(`/api/places?q=${encodeURIComponent('수목원')}&styles=${encodeURIComponent('자연·산책,휴식·힐링')}`)
  })

  it('경로는 요청 순서대로 key 를 붙여 돌려받는다', async () => {
    const fn = stubFetch(200, [])
    await realApi.legs.get([])
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ requests: [] })
  })

  it('초대 참가는 고른 관계를 본문에 담고, 안 골랐으면 빈 본문을 보낸다', async () => {
    const fn = stubFetch(200, { groupId: 'g', alreadyMember: false })
    await realApi.invites.accept('t 1', '엄마')
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/invites/t%201/accept')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ relation: '엄마' })

    await realApi.invites.accept('t')
    const [, noRelation] = fn.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(String(noRelation.body))).toEqual({})
  })

  it('건강 정보는 목록·저장·지우기 주소를 쓰고, 지우기는 204 라 본문 없이 끝난다', async () => {
    const health = { tripId: 't 1', travelerId: 'tr 1', conditions: ['diabetes'], medicationClasses: [], visibility: 'self', consentAt: '2026-11-02T01:00:00.000Z', enteredByUserId: 'u' }
    const fn = stubFetch(200, { health: [health] })
    expect(await realApi.health.list('t 1')).toEqual([health])
    expect(fn).toHaveBeenCalledWith('/api/trips/t%201/health', expect.objectContaining({ credentials: 'same-origin' }))

    const putFn = stubFetch(200, health)
    const body: TravelerHealthInput = { conditions: ['diabetes'], medicationClasses: [], visibility: 'self', consent: true }
    expect(await realApi.health.put('t 1', 'tr 1', body)).toEqual(health)
    const [putUrl, putInit] = putFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(putUrl).toBe('/api/trips/t%201/travelers/tr%201/health')
    expect(putInit.method).toBe('PUT')
    expect(JSON.parse(String(putInit.body))).toEqual(body)

    const delFn = stubFetch(204, undefined)
    await expect(realApi.health.remove('t 1', 'tr 1')).resolves.toBeUndefined()
    const [delUrl, delInit] = delFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(delUrl).toBe('/api/trips/t%201/travelers/tr%201/health')
    expect(delInit.method).toBe('DELETE')
  })

  it('날씨는 여행 주소 아래에서 받고, 모양이 다르면 막는다', async () => {
    const weather = { checkedAt: '2026-11-03T01:00:00.000Z', days: [{ day: 1, date: '2026-11-04', status: 'too_far', forecast: null }] }
    const fn = stubFetch(200, weather)
    expect(await realApi.weather.get('t 1')).toEqual(weather)
    expect(fn).toHaveBeenCalledWith('/api/trips/t%201/weather', expect.objectContaining({ credentials: 'same-origin' }))
    stubFetch(200, { days: [{ day: 1, status: 'sunny' }] })
    await expect(realApi.weather.get('t')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('건강 정보 목록 응답의 모양이 다르면 에러로 막는다', async () => {
    stubFetch(200, [])
    await expect(realApi.health.list('t')).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('로그인 확인은 Better Auth 의 세션 주소를 쓰고, 로그인 안 했으면 null', async () => {
    const fn = stubFetch(200, null)
    expect(await realApi.auth.getSession()).toBeNull()
    expect(fn).toHaveBeenCalledWith('/api/auth/get-session', expect.anything())
  })
})
