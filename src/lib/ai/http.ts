// AI API route의 공용 도우미. 에러 응답 모양을 계약({ error: { code, message, fallback? } }) 하나로 묶는다 (설계 6.4).
import 'server-only'
import { z } from 'zod'
import type { AiError, ApiErrorCode, ApiError, TripVersion } from '@/lib/contracts'
import { AiErrorSchema, ApiErrorSchema } from '@/lib/contracts'
import type { AiFallback, TripContext } from './deps'
import { AiCallError } from './client'

// API가 정상 실패(401·403·404·400 등)를 내는 정해진 방법 — 각 route에서 throw한다.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fallback?: AiFallback,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

// 받은 값을 스키마로 검사한다 (AGENTS.md 4장). 검사 실패는 모두 invalid_request 하나로 통일해,
// 요청 내용(키·내부 값)을 응답에 노출하지 않는다.
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let unknownBody: unknown
  try {
    unknownBody = await request.json()
  } catch {
    throw new HttpError(400, 'invalid_request', '요청 내용을 읽을 수 없어요')
  }
  const result = schema.safeParse(unknownBody)
  if (!result.success) {
    throw new HttpError(400, 'invalid_request', '요청 내용이 형식에 맞지 않아요')
  }
  return result.data
}

// 각 API가 자기 AI 실패 fallback(설계 6.4)을 handle의 두 번째 인자로 넘긴다 —
// 붙여넣기(parse-schedule)는 'pick_places', 처음부터(generate)·다시 짜기(revise)는 'retry_or_pick'.
// handle까지 그대로 흘러온 AiCallError는 갈래를 알 수 없으므로 공용 대체 'retry_or_pick'을 쓴다.
const DEFAULT_AI_FALLBACK: AiFallback = 'retry_or_pick'

type AIErrorBody = AiError['error'] | ApiError['error']

// aiFallback이 null이면 fallback 칸 없이 돌려준다 (handle에 옵션을 안 넘긴 경우)
function errorBody(error: unknown, aiFallback: AiFallback | null): { body: AIErrorBody; status: number } {
  if (error instanceof HttpError) {
    return {
      body: {
        code: error.code,
        message: error.message,
        ...(error.fallback ? { fallback: error.fallback } : {}),
      },
      status: error.status,
    }
  }
  if (error instanceof AiCallError) {
    return {
      body: {
        code: 'ai_failed',
        message: 'AI 요청이 실패했어요',
        ...(aiFallback ? { fallback: aiFallback } : {}),
      },
      status: 502,
    }
  }
  // 그 외(서버 버그·DB 오류)는 내용을 응답에 담지 않고 서버 로그에만 남긴다
  const errorName = error instanceof Error ? error.name : typeof error
  const errorMessage = error instanceof Error ? error.message : String(error)
  console.error('[ai]', errorName, errorMessage)
  return {
    body: { code: 'internal_error', message: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요' },
    status: 500,
  }
}

function toResponse(body: AIErrorBody, status: number): Response {
  // 응답도 계약 모양과 맞는지 검사해 내보낸다 — fallback은 AI 실패(ai_failed)에만 의미가 있다.
  const schema = body.code === 'ai_failed' ? AiErrorSchema : ApiErrorSchema
  const parsed = schema.parse({ error: body })
  return Response.json(parsed, { status })
}

export function errorResponse(error: unknown): Response {
  const { body, status } = errorBody(error, DEFAULT_AI_FALLBACK)
  return toResponse(body, status)
}

export async function handle(fn: () => Promise<unknown>, opts?: { aiFallback?: AiFallback }): Promise<Response> {
  try {
    return Response.json(await fn())
  } catch (error) {
    // handle에 fallback을 넘긴 AiCallError는 그 값을 쓰고, 안 넘겼으면 fallback 칸 없이 돌려준다
    if (error instanceof AiCallError) {
      const { body, status } = errorBody(error, opts?.aiFallback ?? null)
      return toResponse(body, status)
    }
    return errorResponse(error)
  }
}

// 그 여행의 버전이 맞는지 확인한다 — 다른 그룹 버전 id로 의견이 새는 것을 막는다 (설계 10.4)
export function requireVersionInTrip(ctx: TripContext, versionId: string): TripVersion {
  const version = ctx.versions.find(candidate => candidate.id === versionId)
  if (!version) throw new HttpError(404, 'not_found', '버전을 찾을 수 없어요')
  return version
}
