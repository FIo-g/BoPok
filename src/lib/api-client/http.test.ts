import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InviteSchema } from '@/lib/contracts'
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

  it('로그인 확인은 Better Auth 의 세션 주소를 쓰고, 로그인 안 했으면 null', async () => {
    const fn = stubFetch(200, null)
    expect(await realApi.auth.getSession()).toBeNull()
    expect(fn).toHaveBeenCalledWith('/api/auth/get-session', expect.anything())
  })
})
