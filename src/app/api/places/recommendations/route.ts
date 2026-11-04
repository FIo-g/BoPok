import { PlaceRecommendationRequestSchema } from '@/lib/contracts'
import { HttpError, requireUser } from '@/lib/auth'
import { recommendServicePlaces } from '@/lib/places/recommendations'
import { placeError, placeResponse, readPlaceJson } from '@/lib/places/http'

export async function POST(request: Request): Promise<Response> {
  try { await requireUser(request) } catch (error) {
    return error instanceof HttpError ? placeError(error.status, error.code, error.message)
      : placeError(500, 'internal_error', '로그인을 확인하지 못했어요.')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return placeError(415, 'invalid_request', 'JSON으로 추천 조건을 보내 주세요.')
  }
  let value: unknown
  try { value = await readPlaceJson(request) } catch { return placeError(400, 'invalid_request', '추천 조건을 확인해 주세요.') }
  const parsed = PlaceRecommendationRequestSchema.safeParse(value)
  if (!parsed.success) return placeError(400, 'invalid_request', '추천 조건을 확인해 주세요.')
  try { return placeResponse(await recommendServicePlaces(parsed.data)) } catch {
    return placeError(500, 'internal_error', '추천 후보를 불러오지 못했어요.')
  }
}
