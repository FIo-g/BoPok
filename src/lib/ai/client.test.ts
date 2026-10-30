import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AiCallError, callJson, providersFromEnv, type AiProvider, type ChatMessage, type FetchLike } from './client'

const schema = z.object({ ok: z.boolean() })
const messages: ChatMessage[] = [{ role: 'user', content: 'JSON을 내줘' }]

const upstage: AiProvider = { name: 'upstage', baseUrl: 'http://upstage.test/v1', model: 'm1', apiKey: 'secret-key-aa' }
const opencode: AiProvider = { name: 'opencode', baseUrl: 'http://opencode.test/v1', model: 'm2', apiKey: 'secret-key-bb' }

type CallInfo = { url: string; init: RequestInit; body: Record<string, unknown> }

// 하는 일: 실제 API를 부르지 않고 요청 꼴·횟수를 남기는 가짜 fetch
function fakeFetch(handler: (call: CallInfo, index: number) => Response) {
  const calls: CallInfo[] = []
  const fn: FetchLike = async (url, init) => {
    const call: CallInfo = { url, init, body: JSON.parse(String(init.body)) }
    calls.push(call)
    return handler(call, calls.length - 1)
  }
  return { fn, calls }
}

function okResponse(content: string): Response {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) } as unknown as Response
}

function statusResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

describe('callJson', () => {
  it('처음 답이 맞으면 그대로', async () => {
    const { fn, calls } = fakeFetch(() => okResponse('{"ok":true}'))
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage] })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    const first = calls[0]!
    expect(first.url).toBe('http://upstage.test/v1/chat/completions')
    expect(first.body.model).toBe('m1')
    expect(first.body.temperature).toBe(0.2)
    expect(first.body.response_format).toEqual({ type: 'json_object' })
    expect(first.init.headers).toMatchObject({ Authorization: 'Bearer secret-key-aa' })
  })

  it('형식이 틀리면 한 번 다시 묻고 통과', async () => {
    const { fn, calls } = fakeFetch((_call, i) => (i === 0 ? okResponse('{"ok":"아니야"}') : okResponse('{"ok":true}')))
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage] })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    const retryMessages = calls[1]!.body.messages as ChatMessage[]
    expect(retryMessages).toHaveLength(3)
    expect(retryMessages[1]).toEqual({ role: 'assistant', content: '{"ok":"아니야"}' })
    expect(retryMessages[2]?.role).toBe('user')
    expect(retryMessages[2]?.content).toContain('앞 답이 형식에 맞지 않았다')
  })

  it('두 번 틀리면 다음 공급자', async () => {
    const { fn, calls } = fakeFetch(
      (_call, i) => (i < 2 ? okResponse('형식에 안 맞는 말') : okResponse('{"ok":true}')),
    )
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] })
    expect(result).toEqual({ ok: true })
    // upstage에서 두 번 다시 묻고, opencode에서 한 번에 성공
    expect(calls).toHaveLength(3)
    expect(calls.pop()?.url).toBe('http://opencode.test/v1/chat/completions')
  })

  it('429면 바로 다음 공급자', async () => {
    const { fn, calls } = fakeFetch((_call, i) => (i === 0 ? statusResponse(429) : okResponse('{"ok":true}')))
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2) // 재시도 없이 다음 공급자로
  })

  it('울타리 친 JSON도 읽음', async () => {
    const { fn } = fakeFetch(() => okResponse('```json\n{"ok":true}\n```'))
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage] })
    expect(result).toEqual({ ok: true })
  })

  it('울타리처럼 보여도 JSON 문자열이면 그대로 읽음', async () => {
    const textSchema = z.object({ text: z.string() })
    const { fn, calls } = fakeFetch(() => okResponse('{"text":"```코드```"}'))
    const result = await callJson({ messages, schema: textSchema }, { fetch: fn, providers: [upstage] })
    expect(result).toEqual({ text: '```코드```' })
    expect(calls).toHaveLength(1) // 울타리를 먼저 벗기면 깨지므로 날것부터 읽는다
  })

  it('네트워크 예외면 재시도 없이 다음 공급자', async () => {
    const { fn, calls } = fakeFetch((_call, i) => {
      if (i === 0) throw new Error('연결이 끊겼어요')
      return okResponse('{"ok":true}')
    })
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toBe('http://opencode.test/v1/chat/completions')
  })

  it('401이면 재시도 없이 다음 공급자', async () => {
    const { fn, calls } = fakeFetch((_call, i) => (i === 0 ? statusResponse(401) : okResponse('{"ok":true}')))
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('503이면 재시도 없이 다음 공급자', async () => {
    const { fn, calls } = fakeFetch((_call, i) => (i === 0 ? statusResponse(503) : okResponse('{"ok":true}')))
    const result = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('두 번 형식 오류가 계속되면 마지막 reason은 invalid_output', async () => {
    const { fn, calls } = fakeFetch(() => okResponse('형식에 안 맞는 말'))
    const error = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] }).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('invalid_output')
    expect(calls).toHaveLength(4) // 공급자마다 처음 한 번 + 다시 한 번
  })

  it('모두 실패하면 공급자마다 한 번씩만 부른다', async () => {
    const { fn, calls } = fakeFetch(() => statusResponse(500))
    const error = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] }).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('provider_failed')
    expect(calls).toHaveLength(2)
  })

  it('전체 마감을 넘기면 남은 시도를 하지 않고 provider_failed', async () => {
    let nowCalls = 0
    const now = () => (nowCalls++ === 0 ? 0 : 60000) // 시작은 0시, 그 뒤는 마감(45000) 이후
    const { fn, calls } = fakeFetch(() => okResponse('{"ok":true}'))
    const error = await callJson(
      { messages, schema },
      { fetch: fn, providers: [upstage], deadlineMs: 45000, now },
    ).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('provider_failed')
    expect(calls).toHaveLength(0)
  })

  it('형식 실패 뒤 마감을 넘기면 다시 묻지 않는다', async () => {
    let n = 0
    const now = () => (n++ < 2 ? 0 : 60000) // 시작·첫 시도 때는 0시, 다시 묻기 전에는 마감 이후
    const { fn, calls } = fakeFetch(() => okResponse('{"ok":"아니야"}'))
    const error = await callJson(
      { messages, schema },
      { fetch: fn, providers: [upstage], deadlineMs: 45000, now },
    ).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('provider_failed')
    expect(calls).toHaveLength(1)
  })

  it('각 요청 시간 초과는 timeoutMs와 남은 시간 중 작은 값', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    try {
      let n = 0
      const now = () => (n++ === 0 ? 0 : 44000) // 남은 시간 1000
      const { fn } = fakeFetch(() => okResponse('{"ok":true}'))
      await callJson({ messages, schema }, { fetch: fn, providers: [upstage], timeoutMs: 30000, deadlineMs: 45000, now })
      expect(spy).toHaveBeenCalledWith(1000)
    } finally {
      spy.mockRestore()
    }
  })

  it('공급자 없으면 no_provider', async () => {
    await expect(callJson({ messages, schema }, { fetch: fakeFetch(() => okResponse('{}')).fn, providers: [] })).rejects.toMatchObject({
      reason: 'no_provider',
    })
  })

  it('모두 실패면 AiCallError', async () => {
    const { fn } = fakeFetch(() => statusResponse(500))
    const error = await callJson({ messages, schema }, { fetch: fn, providers: [upstage, opencode] }).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('provider_failed')
  })

  it('providersFromEnv: 키 없으면 빠지고 opencode는 모델이 있어야', () => {
    expect(providersFromEnv({})).toEqual([])
    const env = { UPSTAGE_API_KEY: 'k1', OPENCODE_API_KEY: 'k2' }
    // opencode는 모델이 없어서 뺀다
    expect(providersFromEnv(env).map(p => p.name)).toEqual(['upstage'])
    expect(providersFromEnv({ ...env, OPENCODE_MODEL: 'm2' }).map(p => p.name)).toEqual(['upstage', 'opencode'])
    const only = providersFromEnv({ UPSTAGE_API_KEY: 'k1' })[0]
    expect(only?.baseUrl).toBe('https://api.upstage.ai/v1')
    expect(only?.model).toBe('solar-pro2')
  })

  it('providersFromEnv: 빈 문자열·공백은 없음으로 본다', () => {
    // 주소·모델이 비어 있거나 공백이면 기본값을 쓴다
    const blank = providersFromEnv({ UPSTAGE_API_KEY: 'k', UPSTAGE_BASE_URL: '', UPSTAGE_MODEL: '  ' })[0]
    expect(blank?.baseUrl).toBe('https://api.upstage.ai/v1')
    expect(blank?.model).toBe('solar-pro2')
    // 공백뿐인 키·모델은 없는 것으로 본다
    expect(providersFromEnv({ UPSTAGE_API_KEY: '  ' })).toEqual([])
    expect(providersFromEnv({ OPENCODE_API_KEY: 'k2', OPENCODE_MODEL: '  ' }).map(p => p.name)).toEqual([])
  })

  it('providersFromEnv: baseUrl 끝의 /는 뗀다', () => {
    const withSlash = providersFromEnv({ UPSTAGE_API_KEY: 'k', UPSTAGE_BASE_URL: 'https://x/v1/' })[0]
    expect(withSlash?.baseUrl).toBe('https://x/v1')
  })

  it('에러 메시지에 키가 없다', async () => {
    // fetch가 키를 담은 예외를 던져도 메시지에 키가 새지 않아야 한다
    const { fn } = fakeFetch(() => {
      throw new Error('요청 실패: Bearer secret-key-aa 헤더 확인')
    })
    const error = await callJson({ messages, schema }, { fetch: fn, providers: [upstage] }).catch(e => e)
    expect(error).toBeInstanceOf(Error)
    expect(String(error.message)).not.toContain('secret-key')
  })
})
