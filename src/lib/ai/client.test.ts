import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  AiCallError,
  callJson,
  providersFromEnv,
  type AiProvider,
  type ChatMessage,
  type ClaudeClientFactory,
  type ClaudeClientOptions,
  type ClaudeCreateParams,
  type ClaudeReply,
  type FetchLike,
} from './client'

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

  it('opencode에는 x-opencode-session을 보내고, 같은 호출의 재시도는 같은 세션을 쓴다', async () => {
    const { fn, calls } = fakeFetch((_call, i) => (i === 0 ? okResponse('{"ok":"아니야"}') : okResponse('{"ok":true}')))
    await callJson({ messages, schema }, { fetch: fn, providers: [opencode] })
    const sessions = calls.map(call => (call.init.headers as Record<string, string>)['x-opencode-session'])
    expect(sessions[0]).toMatch(/^bopok-/)
    expect(sessions[1]).toBe(sessions[0])
  })

  it('upstage에는 x-opencode-session을 보내지 않는다', async () => {
    const { fn, calls } = fakeFetch(() => okResponse('{"ok":true}'))
    await callJson({ messages, schema }, { fetch: fn, providers: [upstage] })
    expect(calls[0]!.init.headers).not.toHaveProperty('x-opencode-session')
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
    expect(only).toMatchObject({ baseUrl: 'https://api.upstage.ai/v1', model: 'solar-pro4' })
  })

  it('providersFromEnv: 빈 문자열·공백은 없음으로 본다', () => {
    // 주소·모델이 비어 있거나 공백이면 기본값을 쓴다
    const blank = providersFromEnv({ UPSTAGE_API_KEY: 'k', UPSTAGE_BASE_URL: '', UPSTAGE_MODEL: '  ' })[0]
    expect(blank).toMatchObject({ baseUrl: 'https://api.upstage.ai/v1', model: 'solar-pro4' })
    // 공백뿐인 키·모델은 없는 것으로 본다
    expect(providersFromEnv({ UPSTAGE_API_KEY: '  ' })).toEqual([])
    expect(providersFromEnv({ OPENCODE_API_KEY: 'k2', OPENCODE_MODEL: '  ' }).map(p => p.name)).toEqual([])
  })

  it('providersFromEnv: baseUrl 끝의 /는 뗀다', () => {
    const withSlash = providersFromEnv({ UPSTAGE_API_KEY: 'k', UPSTAGE_BASE_URL: 'https://x/v1/' })[0]
    expect(withSlash).toMatchObject({ baseUrl: 'https://x/v1' })
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

  it('401 오류 메시지에 code는 남기고 키 값은 가린다', async () => {
    // 공급자 본문에 키가 되돌아와도 로그·메시지에는 원문이 남지 않아야 한다
    const body = { error: { code: 'invalid_api_key', message: 'bad key sk-abcdefghijklmnopqrstuvwxyz123456' } }
    const fn: FetchLike = async () =>
      ({ ok: false, status: 401, json: async () => body }) as unknown as Response
    const error = await callJson({ messages, schema }, { fetch: fn, providers: [upstage] }).catch(e => e)
    expect(String(error.message)).toContain('HTTP 401')
    expect(String(error.message)).toContain('invalid_api_key')
    expect(String(error.message)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
  })

  it('공급자 실패 때 공급자 이름과 함께 서버 로그를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { fn } = fakeFetch(() => statusResponse(429))
      await callJson({ messages, schema }, { fetch: fn, providers: [upstage] }).catch(() => undefined)
      expect(spy).toHaveBeenCalledWith('[ai] 공급자 실패', 'upstage', 'm1', expect.stringContaining('HTTP 429'))
    } finally {
      spy.mockRestore()
    }
  })
})

// ---- Claude (공식 SDK) ----

const claude: AiProvider = { name: 'claude', model: 'claude-opus-5-5', apiKey: 'secret-key-cc' }

type ClaudeCall = { options: ClaudeClientOptions; params: ClaudeCreateParams }

// 하는 일: 실제 API를 부르지 않고 SDK 호출 꼴·횟수를 남기는 가짜 Anthropic 클라이언트 공장
function fakeClaude(handler: (call: ClaudeCall, index: number) => ClaudeReply | Promise<ClaudeReply>) {
  const calls: ClaudeCall[] = []
  const factory: ClaudeClientFactory = options => ({
    beta: {
      messages: {
        create: async params => {
          const call: ClaudeCall = { options, params }
          calls.push(call)
          return handler(call, calls.length - 1)
        },
      },
    },
  })
  return { factory, calls }
}

function textReply(...texts: string[]): ClaudeReply {
  return {
    stop_reason: 'end_turn',
    content: texts.map(text => ({ type: 'text' as const, text, citations: null })),
  }
}

function sdkError(status: number, type: string): Error {
  // 실제 SDK가 상태 코드로 고르는 클래스 그대로 만든다 (429 → RateLimitError, 5xx → InternalServerError)
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message: `테스트 오류 ${status}` } },
    `테스트 오류 ${status}`,
    new Headers(),
  )
}

describe('providersFromEnv — Claude', () => {
  it('키가 있으면 맨 앞, 모델 기본값은 claude-opus-5-5', () => {
    const env = { ANTHROPIC_API_KEY: 'ka', UPSTAGE_API_KEY: 'ku', OPENCODE_API_KEY: 'ko', OPENCODE_MODEL: 'm2' }
    expect(providersFromEnv(env).map(p => p.name)).toEqual(['claude', 'upstage', 'opencode'])
    expect(providersFromEnv(env)[0]).toEqual({ name: 'claude', model: 'claude-opus-5-5', apiKey: 'ka' })
  })

  it('ANTHROPIC_MODEL로 모델을 바꾸고, 빈 값·공백이면 기본값', () => {
    expect(providersFromEnv({ ANTHROPIC_API_KEY: 'ka', ANTHROPIC_MODEL: 'claude-x' })[0]?.model).toBe('claude-x')
    expect(providersFromEnv({ ANTHROPIC_API_KEY: 'ka', ANTHROPIC_MODEL: '  ' })[0]?.model).toBe('claude-opus-5-5')
    expect(providersFromEnv({ ANTHROPIC_API_KEY: 'ka', ANTHROPIC_MODEL: '' })[0]?.model).toBe('claude-opus-5-5')
  })

  it('키가 없거나 공백이면 Claude는 없고 나머지 순서는 그대로', () => {
    expect(providersFromEnv({ UPSTAGE_API_KEY: 'ku' }).map(p => p.name)).toEqual(['upstage'])
    expect(providersFromEnv({ ANTHROPIC_API_KEY: '  ', UPSTAGE_API_KEY: 'ku' }).map(p => p.name)).toEqual(['upstage'])
    expect(providersFromEnv({ ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: 'claude-x' })).toEqual([])
  })
})

describe('callJson — Claude', () => {
  it('키가 있으면 Claude를 먼저 부르고, 맞으면 다른 공급자는 부르지 않는다', async () => {
    const providers = providersFromEnv({ ANTHROPIC_API_KEY: 'ka', UPSTAGE_API_KEY: 'ku' })
    const sdk = fakeClaude(() => textReply('{"ok":true}'))
    const http = fakeFetch(() => okResponse('{"ok":false}'))
    const result = await callJson({ messages, schema }, { providers, anthropic: sdk.factory, fetch: http.fn })
    expect(result).toEqual({ ok: true })
    expect(sdk.calls).toHaveLength(1)
    expect(http.calls).toHaveLength(0)
  })

  it('요청 꼴: 공식 SDK beta.messages, 재시도 0, 낮은 effort, 서버 쪽 대체 모델, temperature 없음', async () => {
    const sdk = fakeClaude(() => textReply('{"ok":true}'))
    await callJson(
      {
        messages: [
          { role: 'system', content: 'JSON만 답하라' },
          { role: 'system', content: '한국어로' },
          { role: 'user', content: 'JSON을 내줘' },
          { role: 'assistant', content: '{"ok":"아니야"}' },
          { role: 'user', content: '다시' },
        ],
        schema,
        temperature: 0.7,
      },
      { providers: [claude], anthropic: sdk.factory, timeoutMs: 20000 },
    )
    const call = sdk.calls[0]!
    expect(call.options).toEqual({ apiKey: 'secret-key-cc', maxRetries: 0, timeout: 20000 })
    expect(call.params).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: 'JSON만 답하라\n\n한국어로',
      messages: [
        { role: 'user', content: 'JSON을 내줘' },
        { role: 'assistant', content: '{"ok":"아니야"}' },
        { role: 'user', content: '다시' },
      ],
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    // 현재 모델은 샘플링 매개변수·thinking·prefill을 거절(400)한다 — 아예 보내지 않는다
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(call.params).not.toHaveProperty(key)
    }
  })

  it('system 메시지가 없으면 system을 보내지 않는다', async () => {
    const sdk = fakeClaude(() => textReply('{"ok":true}'))
    await callJson({ messages, schema }, { providers: [claude], anthropic: sdk.factory })
    expect(sdk.calls[0]!.params).not.toHaveProperty('system')
  })

  it('text 블록만 이어 붙이고 thinking·fallback 블록은 무시한다', async () => {
    const sdk = fakeClaude(() => ({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '생각 중', signature: 'sig' },
        { type: 'text', text: '{"ok":', citations: null },
        { type: 'text', text: 'true}', citations: null },
      ],
    }))
    const result = await callJson({ messages, schema }, { providers: [claude], anthropic: sdk.factory })
    expect(result).toEqual({ ok: true })
  })

  it('울타리 친 JSON도 읽음', async () => {
    const sdk = fakeClaude(() => textReply('```json\n{"ok":true}\n```'))
    const result = await callJson({ messages, schema }, { providers: [claude], anthropic: sdk.factory })
    expect(result).toEqual({ ok: true })
  })

  it('형식이 틀리면 Claude에 한 번 다시 묻고 통과', async () => {
    const sdk = fakeClaude((_call, i) => (i === 0 ? textReply('{"ok":"아니야"}') : textReply('{"ok":true}')))
    const result = await callJson({ messages, schema }, { providers: [claude], anthropic: sdk.factory })
    expect(result).toEqual({ ok: true })
    expect(sdk.calls).toHaveLength(2)
    const retry = sdk.calls[1]!.params.messages
    expect(retry).toHaveLength(3)
    expect(retry[1]).toEqual({ role: 'assistant', content: '{"ok":"아니야"}' })
    expect(retry[2]?.role).toBe('user')
    expect(retry[2]?.content).toContain('앞 답이 형식에 맞지 않았다')
  })

  it('Claude가 두 번 틀리면 다음 공급자', async () => {
    const sdk = fakeClaude(() => textReply('형식에 안 맞는 말'))
    const http = fakeFetch(() => okResponse('{"ok":true}'))
    const result = await callJson({ messages, schema }, { providers: [claude, upstage], anthropic: sdk.factory, fetch: http.fn })
    expect(result).toEqual({ ok: true })
    expect(sdk.calls).toHaveLength(2)
    expect(http.calls).toHaveLength(1)
  })

  it('429(RateLimitError)면 재시도 없이 다음 공급자', async () => {
    const sdk = fakeClaude(() => {
      throw sdkError(429, 'rate_limit_error')
    })
    const http = fakeFetch(() => okResponse('{"ok":true}'))
    const result = await callJson({ messages, schema }, { providers: [claude, upstage], anthropic: sdk.factory, fetch: http.fn })
    expect(result).toEqual({ ok: true })
    expect(sdk.calls).toHaveLength(1)
    expect(http.calls).toHaveLength(1)
  })

  it('stop_reason이 refusal이면 공급자 실패로 보고 다음 공급자', async () => {
    const sdk = fakeClaude(() => ({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: '{"ok":true}', citations: null }], // 거절 응답의 글은 쓰지 않는다
    }))
    const http = fakeFetch(() => okResponse('{"ok":true}'))
    const result = await callJson({ messages, schema }, { providers: [claude, upstage], anthropic: sdk.factory, fetch: http.fn })
    expect(result).toEqual({ ok: true })
    expect(sdk.calls).toHaveLength(1) // 다시 묻지 않는다
    expect(http.calls).toHaveLength(1)
  })

  it.each([
    ['401 AuthenticationError', () => sdkError(401, 'authentication_error')],
    ['500 InternalServerError', () => sdkError(500, 'api_error')],
    ['529 overloaded', () => sdkError(529, 'overloaded_error')],
    ['400 BadRequestError', () => sdkError(400, 'invalid_request_error')],
    ['네트워크 APIConnectionError', () => new Anthropic.APIConnectionError({ message: '연결이 끊겼어요' })],
    ['시간 초과 APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError()],
    ['알 수 없는 예외', () => new TypeError('이상한 오류')],
  ])('%s면 재시도 없이 다음 공급자', async (_name, makeError) => {
    const sdk = fakeClaude(() => {
      throw makeError()
    })
    const http = fakeFetch(() => okResponse('{"ok":true}'))
    const result = await callJson({ messages, schema }, { providers: [claude, upstage], anthropic: sdk.factory, fetch: http.fn })
    expect(result).toEqual({ ok: true })
    expect(sdk.calls).toHaveLength(1)
    expect(http.calls).toHaveLength(1)
  })

  it('text 블록이 없으면 공급자 실패', async () => {
    const sdk = fakeClaude(() => ({ stop_reason: 'end_turn', content: [] }))
    const error = await callJson({ messages, schema }, { providers: [claude], anthropic: sdk.factory }).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('provider_failed')
  })

  it('Claude만 있고 거절·실패하면 provider_failed', async () => {
    const sdk = fakeClaude(() => ({ stop_reason: 'refusal', content: [] }))
    const error = await callJson({ messages, schema }, { providers: [claude], anthropic: sdk.factory }).catch(e => e)
    expect(error).toBeInstanceOf(AiCallError)
    expect(error.reason).toBe('provider_failed')
  })

  it('SDK 시간 초과는 timeoutMs와 남은 시간 중 작은 값', async () => {
    let n = 0
    const now = () => (n++ === 0 ? 0 : 44000) // 남은 시간 1000
    const sdk = fakeClaude(() => textReply('{"ok":true}'))
    await callJson(
      { messages, schema },
      { providers: [claude], anthropic: sdk.factory, timeoutMs: 30000, deadlineMs: 45000, now },
    )
    expect(sdk.calls[0]!.options.timeout).toBe(1000)
  })

  it('전체 마감을 넘기면 Claude도 부르지 않고 provider_failed', async () => {
    let n = 0
    const now = () => (n++ === 0 ? 0 : 60000)
    const sdk = fakeClaude(() => textReply('{"ok":true}'))
    const error = await callJson(
      { messages, schema },
      { providers: [claude], anthropic: sdk.factory, deadlineMs: 45000, now },
    ).catch(e => e)
    expect(error.reason).toBe('provider_failed')
    expect(sdk.calls).toHaveLength(0)
  })

  it('실패 로그에 공급자·상태만 남기고 키·프롬프트 내용은 남기지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const sdk = fakeClaude(() => {
        throw sdkError(429, 'rate_limit_error')
      })
      const secretMessages: ChatMessage[] = [{ role: 'user', content: '비밀스러운 사용자 입력' }]
      const error = await callJson({ messages: secretMessages, schema }, { providers: [claude], anthropic: sdk.factory }).catch(e => e)
      expect(spy).toHaveBeenCalledWith('[ai] 공급자 실패', 'claude', 'claude-opus-5-5', expect.stringContaining('HTTP 429'))
      const logged = JSON.stringify(spy.mock.calls)
      for (const text of [logged, String(error.message)]) {
        expect(text).not.toContain('secret-key-cc')
        expect(text).not.toContain('비밀스러운 사용자 입력')
      }
    } finally {
      spy.mockRestore()
    }
  })
})
