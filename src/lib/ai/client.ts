// AI 호출을 한 곳에 모은다 (설계 6.2). 모든 AI 요청은 이 파일의 callJson으로만 한다.
// 키는 환경 변수로만 받고, 로그·에러 메시지에 키 값은 절대 넣지 않는다.
import 'server-only'
import type { z } from 'zod'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type AiProvider = { name: 'upstage' | 'opencode'; baseUrl: string; model: string; apiKey: string }
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

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

// Upstage 먼저, opencode는 모델이 정해져 있을 때만. 키 없는 공급자는 뺀다
export function providersFromEnv(env: Record<string, string | undefined> = process.env): AiProvider[] {
  const providers: AiProvider[] = []
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

// 공급자 한 곳에 한 번 묻는다. 공급자 단위 실패(네트워크·시간 초과·429·5xx·401 등)는 재시도 없이 던진다
async function askOnce(
  provider: AiProvider,
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

export async function callJson<T>(
  req: { messages: ChatMessage[]; schema: z.ZodType<T>; temperature?: number },
  deps?: {
    fetch?: FetchLike
    providers?: AiProvider[]
    timeoutMs?: number
    deadlineMs?: number
    now?: () => number
  },
): Promise<T> {
  const fetchLike = deps?.fetch ?? (globalThis.fetch as unknown as FetchLike)
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
        content = await askOnce(provider, currentMessages, fetchLike, temperature, Math.min(timeoutMs, remainingMs), sessionId)
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
