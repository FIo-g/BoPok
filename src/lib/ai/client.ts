// AI 호출을 한 곳에 모은다 (설계 6.2). 모든 AI 요청은 이 파일의 callJson으로만 한다.
// 키는 환경 변수로만 받고, 로그·에러 메시지에 키 값은 절대 넣지 않는다.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
// Claude는 공식 SDK로 부르므로 baseUrl이 없다. upstage·opencode는 OpenAI 호환 chat/completions
export type ClaudeProvider = { name: 'claude'; model: string; apiKey: string }
export type ChatCompletionsProvider = { name: 'upstage' | 'opencode'; baseUrl: string; model: string; apiKey: string }
export type AiProvider = ClaudeProvider | ChatCompletionsProvider
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

// 테스트에서 실제 API 대신 가짜를 끼우려고 SDK 호출면만 좁게 정의한다 — 진짜 Anthropic 클라이언트도 그대로 들어맞는다
export type ClaudeCreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
export type ClaudeReply = Pick<Anthropic.Beta.Messages.BetaMessage, 'content' | 'stop_reason'>
export type ClaudeClientOptions = { apiKey: string; maxRetries: 0; timeout: number }
export type ClaudeClient = {
  beta: { messages: { create: (params: ClaudeCreateParams) => PromiseLike<ClaudeReply> } }
}
export type ClaudeClientFactory = (options: ClaudeClientOptions) => ClaudeClient

const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
// 서버 쪽 대체 모델(fallbacks: 'default')을 쓰려면 이 베타 헤더가 있어야 한다
const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// 키 값은 메시지에 담지 않는다 — 원인은 reason으로만 구분한다
export class AiCallError extends Error {
  constructor(
    readonly reason: 'no_provider' | 'invalid_output' | 'provider_failed',
    message: string,
  ) {
    super(message)
    this.name = 'AiCallError'
  }
}

// 빈 문자열·공백도 "없음"으로 본다 — env.X?.trim() || 기본값
function textOrDefault(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback
}

// baseUrl 끝의 '/'는 뗀다 — 뒤에 '/chat/completions'을 붙이므로 겹치지 않게
function stripTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// 로그에는 짧은 요약만 남긴다. 키처럼 긴 토큰은 가린다 (AGENTS.md 7장)
function safeSnippet(text: string, max = 160): string {
  return text.replace(/[A-Za-z0-9_\-]{24,}/g, '***').slice(0, max)
}

// 공급자 오류 응답의 code/type/message만 짧게 꺼낸다. 본문 전체는 남기지 않는다
async function upstreamErrorSummary(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const error = (body as { error: unknown }).error
      if (error && typeof error === 'object') {
        const e = error as { code?: unknown; type?: unknown; message?: unknown }
        const parts = [e.code, e.type, e.message].filter((v): v is string => typeof v === 'string')
        if (parts.length > 0) return safeSnippet(parts.join(' / '))
      }
      if (typeof error === 'string') return safeSnippet(error)
    }
  } catch {
    // JSON이 아닌 오류 본문은 요약하지 않는다
  }
  return ''
}

// Claude 먼저, 그다음 Upstage, opencode는 모델이 정해져 있을 때만. 키 없는 공급자는 뺀다
export function providersFromEnv(env: Record<string, string | undefined> = process.env): AiProvider[] {
  const providers: AiProvider[] = []
  const claudeKey = env.ANTHROPIC_API_KEY?.trim()
  if (claudeKey) {
    providers.push({ name: 'claude', model: textOrDefault(env.ANTHROPIC_MODEL, DEFAULT_CLAUDE_MODEL), apiKey: claudeKey })
  }
  const upstageKey = env.UPSTAGE_API_KEY?.trim()
  if (upstageKey) {
    providers.push({
      name: 'upstage',
      baseUrl: stripTrailingSlash(textOrDefault(env.UPSTAGE_BASE_URL, 'https://api.upstage.ai/v1')),
      model: textOrDefault(env.UPSTAGE_MODEL, 'solar-pro4'),
      apiKey: upstageKey,
    })
  }
  const opencodeKey = env.OPENCODE_API_KEY?.trim()
  const opencodeModel = env.OPENCODE_MODEL?.trim()
  // OPENCODE_MODEL이 비면 opencode 대체를 쓰지 않는다
  if (opencodeKey && opencodeModel) {
    providers.push({
      name: 'opencode',
      baseUrl: stripTrailingSlash(textOrDefault(env.OPENCODE_BASE_URL, 'https://opencode.ai/inference/go/openai/v1')),
      model: opencodeModel,
      apiKey: opencodeKey,
    })
  }
  return providers
}

type JsonContent = { choices?: Array<{ message?: { content?: string | null } }> }

function readContent(response: Response): Promise<string> {
  return response.json().then((body: JsonContent) => {
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('empty content')
    return content
  })
}

// 일부 모델은 JSON 앞뒤에 코드펜스를 붙인다 — 있으면 벗긴다
function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  return (fenced?.[1] ?? text).trim()
}

// 날것부터 읽는다 — '{"text":"```코드```"}'처럼 울타리 기호가 JSON 문자열 안에 있을 수 있다.
// 날것이 깨질 때만 울타리를 벗겨 다시 읽는다
function parseJsonLoose(content: string): unknown {
  try {
    return JSON.parse(content.trim())
  } catch {
    return JSON.parse(stripFence(content))
  }
}

function parseWith<T>(content: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; issues: string } {
  let parsed: unknown
  try {
    parsed = parseJsonLoose(content)
  } catch {
    return { ok: false, issues: 'JSON이 아니다' }
  }
  const result = schema.safeParse(parsed)
  if (result.success) return { ok: true, value: result.data }
  // 다시 묻는 데 쓰는 이슈 요약은 앞 3개만
  const issues = result.error.issues
    .slice(0, 3)
    .map(issue => `${issue.path.map(String).join('.') || '(루트)'}: ${issue.message}`)
    .join(', ')
  return { ok: false, issues }
}

// Claude 오류는 SDK의 타입 에러 클래스로 가른다 (문자열 비교 금지).
// 메시지에는 상태 코드와 오류 종류만 담는다 — 키·프롬프트 내용은 넣지 않는다
function describeClaudeError(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return 'claude 공급자 요청이 실패했어요 (시간 초과)'
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'claude 공급자 요청이 실패했어요 (네트워크)'
  }
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    const detail = error.type ? `: ${safeSnippet(error.type)}` : ''
    // 429·401·5xx(529 과부하 포함)는 공급자 쪽 문제, 그 밖의 4xx는 우리 요청 형식 문제
    if (
      error instanceof Anthropic.RateLimitError ||
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.InternalServerError
    ) {
      return `claude 공급자가 문제를 알렸어요 (HTTP ${error.status}${detail})`
    }
    return `claude 공급자 요청이 형식 오류를 알렸어요 (HTTP ${error.status}${detail})`
  }
  return 'claude 공급자 요청이 실패했어요'
}

// Claude에 한 번 묻고 text 블록만 이어 붙여 돌려준다.
// 현재 모델은 temperature·top_p·top_k·thinking 지정과 prefill을 거절(400)하므로 보내지 않는다
async function askClaude(
  provider: ClaudeProvider,
  messages: ChatMessage[],
  createClient: ClaudeClientFactory,
  timeoutMs: number,
): Promise<string> {
  // OpenAI식 system 메시지는 최상위 system 문자열로, 나머지는 대화 순서 그대로
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')
  const turns: ClaudeCreateParams['messages'] = []
  for (const message of messages) {
    if (message.role !== 'system') turns.push({ role: message.role, content: message.content })
  }
  let reply: ClaudeReply
  try {
    // SDK 자동 재시도는 끄고(maxRetries 0) 재시도·대체는 callJson이 정한 대로만 한다
    const client = createClient({ apiKey: provider.apiKey, maxRetries: 0, timeout: timeoutMs })
    reply = await client.beta.messages.create({
      model: provider.model,
      max_tokens: 16000,
      ...(system ? { system } : {}),
      messages: turns,
      output_config: { effort: 'low' },
      betas: [CLAUDE_FALLBACK_BETA],
      fallbacks: 'default',
    })
  } catch (error) {
    throw new Error(describeClaudeError(error))
  }
  // 거절 응답의 글은 쓰지 않고 공급자 실패로 보내 다음 공급자로 넘어가게 한다
  if (reply.stop_reason === 'refusal') throw new Error('claude 공급자가 요청을 거절했어요 (refusal)')
  let text = ''
  for (const block of reply.content) {
    if (block.type === 'text') text += block.text
  }
  if (!text.trim()) throw new Error('claude 공급자 답이 비어 있어요')
  return text
}

// OpenAI 호환 공급자(upstage·opencode)에 chat/completions로 한 번 묻는다
async function askChatCompletions(
  provider: ChatCompletionsProvider,
  messages: ChatMessage[],
  fetchLike: FetchLike,
  temperature: number,
  timeoutMs: number,
  sessionId: string,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
    'User-Agent': 'bopok/1.0',
  }
  // opencode Go는 x-opencode-session이 없으면 400(MissingSessionID)으로 거절한다
  if (provider.name === 'opencode') headers['x-opencode-session'] = sessionId
  let response: Response
  try {
    response = await fetchLike(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error(`${provider.name} 공급자 요청이 실패했어요 (네트워크·시간 초과)`)
  }
  if (response.status === 429 || response.status === 401 || response.status >= 500) {
    const detail = await upstreamErrorSummary(response)
    throw new Error(`${provider.name} 공급자가 문제를 알렸어요 (HTTP ${response.status}${detail ? `: ${detail}` : ''})`)
  }
  if (!response.ok) {
    const detail = await upstreamErrorSummary(response)
    throw new Error(`${provider.name} 공급자 요청이 형식 오류를 알렸어요 (HTTP ${response.status}${detail ? `: ${detail}` : ''})`)
  }
  return readContent(response)
}

// 공급자 한 곳에 한 번 묻는다. 공급자 단위 실패(네트워크·시간 초과·429·5xx·401·거절 등)는 재시도 없이 던진다
async function askOnce(
  provider: AiProvider,
  messages: ChatMessage[],
  fetchLike: FetchLike,
  createClient: ClaudeClientFactory,
  temperature: number,
  timeoutMs: number,
  sessionId: string,
): Promise<string> {
  if (provider.name === 'claude') return askClaude(provider, messages, createClient, timeoutMs)
  return askChatCompletions(provider, messages, fetchLike, temperature, timeoutMs, sessionId)
}

export async function callJson<T>(
  req: { messages: ChatMessage[]; schema: z.ZodType<T>; temperature?: number },
  deps?: {
    fetch?: FetchLike
    // 테스트에서 가짜 Anthropic 클라이언트를 끼우는 자리 (기본: 공식 SDK)
    anthropic?: ClaudeClientFactory
    providers?: AiProvider[]
    timeoutMs?: number
    deadlineMs?: number
    now?: () => number
  },
): Promise<T> {
  const fetchLike = deps?.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const createClient: ClaudeClientFactory = deps?.anthropic ?? (options => new Anthropic(options))
  const providers = deps?.providers ?? providersFromEnv()
  const timeoutMs = deps?.timeoutMs ?? 30000
  // 전체 마감: 시작 시각부터 지나면 남은 시도를 하지 않는다 (기본 45초)
  const deadlineMs = deps?.deadlineMs ?? 45000
  const now = deps?.now ?? Date.now
  const startedAt = now()
  const temperature = req.temperature ?? 0.2
  // 한 번의 callJson(재시도 포함)은 같은 세션으로 묶는다
  const sessionId = `bopok-${crypto.randomUUID()}`

  if (providers.length === 0) {
    throw new AiCallError('no_provider', '사용할 수 있는 AI 공급자가 환경 변수에 없어요')
  }

  let lastError = new AiCallError('invalid_output', 'AI 답을 받지 못했어요')
  for (const provider of providers) {
    let invalidSeen = false
    let currentMessages = req.messages
    // 형식 실패는 같은 공급자에 한 번만 다시 묻는다 (설계 6.2)
    for (let attempt = 0; attempt < 2; attempt++) {
      // 마감을 넘기면 다음 공급자도 부르지 않는다
      const remainingMs = deadlineMs - (now() - startedAt)
      if (remainingMs <= 0) {
        throw new AiCallError('provider_failed', 'AI 요청 전체 마감 시간을 넘겼어요')
      }
      let content: string
      try {
        // 각 요청 시간 초과는 timeoutMs와 남은 시간 중 작은 값으로 건다
        content = await askOnce(provider, currentMessages, fetchLike, createClient, temperature, Math.min(timeoutMs, remainingMs), sessionId)
      } catch (error) {
        lastError = new AiCallError('provider_failed', error instanceof Error ? error.message : '공급자 호출 실패')
        console.error('[ai] 공급자 실패', provider.name, provider.model, lastError.message)
        invalidSeen = false
        break
      }
      const parsed = parseWith(content, req.schema)
      if (parsed.ok) return parsed.value
      console.error('[ai] 형식 불일치', provider.name, provider.model, `시도 ${attempt + 1}`, safeSnippet(parsed.issues, 200))
      invalidSeen = true
      // 앞 답을 보여 주고 JSON만 다시 보내라고 한다
      currentMessages = [
        ...req.messages,
        { role: 'assistant', content },
        { role: 'user', content: `앞 답이 형식에 맞지 않았다: ${parsed.issues}. JSON만 다시 보내라.` },
      ]
    }
    if (invalidSeen) lastError = new AiCallError('invalid_output', `${provider.name} 공급자 답이 스키마에 맞지 않았어요`)
  }
  throw lastError
}
