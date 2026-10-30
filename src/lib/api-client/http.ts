// fetch 한 겹: 같은 출처의 /api 를 부르고, 응답은 contracts 의 zod 스키마로 검사한다.
// 에러 응답은 contracts 의 ApiErrorSchema 모양({ error: { code, message } })이고, AI 실패에는 fallback 이 붙는다.
import { AiFallbackSchema, ApiErrorCodeSchema, type AiFallback, type ApiErrorCode } from '@/lib/contracts'
import { z } from 'zod'

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  // AI 실패 때 화면이 돌아갈 대체 동작 (직접 고르기 등)
  readonly fallback?: AiFallback

  constructor(status: number, code: ApiErrorCode, message: string, fallback?: AiFallback) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.fallback = fallback
  }
}

export const isApiError = (error: unknown): error is ApiRequestError => error instanceof ApiRequestError

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  410: 'expired',
}

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), fallback: AiFallbackSchema.optional() }),
})

type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  // 응답을 검사할 스키마. 본문이 없는 응답(204)이면 생략한다
  schema?: z.ZodType<T>
}

export async function request<T = void>(path: string, { method = 'GET', body, schema }: RequestOptions<T> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError(0, 'internal_error', '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요')
  }
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(await res.json().catch(() => null))
    const fallbackCode = CODE_BY_STATUS[res.status] ?? 'internal_error'
    if (parsed.success) {
      const code = ApiErrorCodeSchema.safeParse(parsed.data.error.code)
      throw new ApiRequestError(res.status, code.success ? code.data : fallbackCode, parsed.data.error.message, parsed.data.error.fallback)
    }
    throw new ApiRequestError(res.status, fallbackCode, '요청을 처리하지 못했어요. 잠시 뒤에 다시 해 주세요')
  }
  if (!schema) return undefined as T
  const json: unknown = await res.json()
  const result = schema.safeParse(json)
  if (!result.success) throw new ApiRequestError(res.status, 'internal_error', '서버 응답 모양이 달라요')
  return result.data
}
