// 계정·그룹·여행 API의 공용 에러 도우미. 에러 응답을 계약 하나로 묶는다
// ({ error: { code, message } } — src/lib/contracts의 ApiErrorSchema).
// 김태형의 src/lib/ai/http.ts와 역할이 같다(그쪽은 AI 실패 fallback이 더 붙는다).
// 나중에 한 곳으로 합칠 수 있다 — 합칠 때는 두 담당이 함께 본다.
import 'server-only'
import type { ApiErrorCode } from '@/lib/contracts'
import { ApiErrorSchema } from '@/lib/contracts'

// API가 정상 실패(401·403·404·400 등)를 내는 정해진 방법 — 서버 함수에서 throw하고
// route.ts에서 handle이 잡아 응답으로 바꾼다.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const body = ApiErrorSchema.parse({ error: { code: error.code, message: error.message } })
    return Response.json(body, { status: error.status })
  }
  // 그 외(서버 버그·DB 오류)는 내용을 응답에 담지 않고 서버 로그에만 남긴다.
  const errorName = error instanceof Error ? error.name : typeof error
  const errorMessage = error instanceof Error ? error.message : String(error)
  console.error('[acct]', errorName, errorMessage)
  const body = ApiErrorSchema.parse({
    error: { code: 'internal_error', message: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요' },
  })
  return Response.json(body, { status: 500 })
}

// route.ts에서 쓴다: return handle(async () => { ... 결과 객체 ... })
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn())
  } catch (error) {
    return errorResponse(error)
  }
}
