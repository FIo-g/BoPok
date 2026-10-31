import { PlaceDetailSchema, PlaceIdInputSchema } from '@/lib/contracts'
import { getPlaceDetail } from '@/lib/places'
import { placeError, placeResponse } from '@/lib/places/http'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const input = PlaceIdInputSchema.safeParse((await context.params).id)
  if (!input.success) return placeError(400, 'invalid_request', '장소 ID를 확인해 주세요.')
  try {
    const detail = await getPlaceDetail(input.data)
    if (!detail) return placeError(404, 'not_found', '장소를 찾을 수 없어요.')
    return placeResponse(PlaceDetailSchema.parse(detail))
  } catch {
    return placeError(500, 'internal_error', '장소 상세를 불러오지 못했어요.')
  }
}
