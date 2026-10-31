import { PlaceDetailsResponseSchema } from '@/lib/contracts'
import { BoundedPlaceDetailsRequestSchema } from '@/lib/places/validation'
import { getPlaceDetails } from '@/lib/places'
import { placeError, placeResponse, readPlaceJson } from '@/lib/places/http'

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return placeError(415, 'invalid_request', 'JSON 형식으로 보내 주세요.')
  }
  let body: unknown
  try { body = await readPlaceJson(request) } catch {
    return placeError(400, 'invalid_request', 'JSON 요청 본문을 확인해 주세요.')
  }
  const input = BoundedPlaceDetailsRequestSchema.safeParse(body)
  if (!input.success) return placeError(400, 'invalid_request', '장소 ID 목록을 확인해 주세요. 최대 100개까지 보낼 수 있어요.')
  try {
    return placeResponse(PlaceDetailsResponseSchema.parse(await getPlaceDetails(input.data.ids)))
  } catch {
    return placeError(500, 'internal_error', '장소 상세를 불러오지 못했어요.')
  }
}
