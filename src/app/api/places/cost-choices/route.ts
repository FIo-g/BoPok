import { PlaceCostChoicesRequestSchema } from '@/lib/contracts'
import { getPlaceCostChoices } from '@/lib/places/cost-choices'
import { placeError, placeResponse, readPlaceJson } from '@/lib/places/http'

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return placeError(415, 'invalid_request', 'JSON으로 장소 목록을 보내 주세요.')
  }
  let value: unknown
  try { value = await readPlaceJson(request) } catch { return placeError(400, 'invalid_request', '장소 목록을 확인해 주세요.') }
  const input = PlaceCostChoicesRequestSchema.safeParse(value)
  if (!input.success) return placeError(400, 'invalid_request', '장소 목록을 확인해 주세요.')
  try { return placeResponse(await getPlaceCostChoices(input.data)) } catch {
    return placeError(500, 'internal_error', '가격 정보를 불러오지 못했어요.')
  }
}
