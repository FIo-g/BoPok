import { HttpError, requireUser } from '@/lib/auth'
import { TaxiCostRequestSchema } from '@/lib/contracts'
import { quoteTaxiCosts } from '@/lib/geo/taxi-cost'
import { GeoError } from '@/lib/geo/errors'
import { placeError, placeResponse, readPlaceJson } from '@/lib/places/http'

export async function POST(request: Request): Promise<Response> {
  try { await requireUser(request) } catch (error) {
    return error instanceof HttpError ? placeError(error.status, error.code, error.message)
      : placeError(500, 'internal_error', '로그인을 확인하지 못했어요.')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return placeError(415, 'invalid_request', 'JSON으로 택시 구간을 보내 주세요.')
  }
  let body: unknown
  try { body = await readPlaceJson(request) } catch { return placeError(400, 'invalid_request', '택시 구간을 확인해 주세요.') }
  const input = TaxiCostRequestSchema.safeParse(body)
  if (!input.success) return placeError(400, 'invalid_request', '택시 구간을 확인해 주세요.')
  try { return placeResponse(await quoteTaxiCosts(input.data)) } catch (error) {
    if (error instanceof GeoError) return error.kind === 'invalid_request'
      ? placeError(400, 'invalid_request', error.message)
      : placeError(503, 'external_api_failed', error.message)
    return placeError(500, 'internal_error', '택시 요금을 추정하지 못했어요.')
  }
}
