import { ApiErrorSchema, LegsResponseSchema, type ApiErrorCode } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import { requireUser } from '@/lib/auth/session'
import { GeoError } from '@/lib/geo/errors'
import { getLegs } from '@/lib/geo/legs'
import { LegsInputSchema } from '@/lib/geo/validation'
import { readPlaceJson } from '@/lib/places/http'

function failure(status: number, code: ApiErrorCode, message: string) {
  return Response.json(ApiErrorSchema.parse({ error: { code, message } }), {
    status, headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: Request): Promise<Response> {
  try { await requireUser(request) } catch (error) {
    if (error instanceof HttpError) return failure(error.status, error.code, error.message)
    return failure(500, 'internal_error', '로그인 상태를 확인하지 못했어요.')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return failure(415, 'invalid_request', 'JSON 형식으로 보내 주세요.')
  }
  let body: unknown
  try { body = await readPlaceJson(request) } catch {
    return failure(400, 'invalid_request', 'JSON 요청 본문을 확인해 주세요. 최대 16 KiB까지 보낼 수 있어요.')
  }
  const parsed = LegsInputSchema.safeParse(body)
  if (!parsed.success) return failure(400, 'invalid_request', '경로 요청을 확인해 주세요. 최대 20개까지 보낼 수 있어요.')
  try {
    const legs = LegsResponseSchema.parse(await getLegs(parsed.data.requests))
    return Response.json(legs, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof GeoError) {
      switch (error.kind) {
        case 'invalid_request': return failure(400, 'invalid_request', error.message)
        case 'unsupported_mode': return failure(422, 'invalid_request', error.message)
        case 'missing_key': return failure(503, 'internal_error', error.message)
        case 'timeout': return failure(504, 'external_api_failed', error.message)
        case 'upstream': return failure(502, 'external_api_failed', error.message)
      }
    }
    return failure(500, 'internal_error', '경로를 불러오거나 저장하지 못했어요.')
  }
}
