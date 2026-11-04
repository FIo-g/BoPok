import { PlaceListQuerySchema, PlaceSummaryListSchema } from '@/lib/contracts'
import { listPlaces } from '@/lib/places'
import { placeError, placeResponse } from '@/lib/places/http'

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  if (['q', 'styles', 'kind', 'limit'].some(key => params.getAll(key).length > 1)) {
    return placeError(400, 'invalid_request', '검색 조건은 한 번씩만 보내 주세요.')
  }
  const input = PlaceListQuerySchema.safeParse({
    q: params.get('q') ?? '',
    styles: (params.get('styles') ?? '').split(',').map(style => style.trim()).filter(Boolean),
    kind: params.get('kind') ?? undefined,
    limit: params.has('limit') ? Number(params.get('limit')) : 100,
  })
  if (!input.success) return placeError(400, 'invalid_request', '검색 조건을 확인해 주세요.')
  try {
    return placeResponse(PlaceSummaryListSchema.parse(await listPlaces(input.data)))
  } catch {
    return placeError(500, 'internal_error', '장소 목록을 불러오지 못했어요.')
  }
}
