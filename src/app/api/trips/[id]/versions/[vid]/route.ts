// 버전 전체(stops 포함) 조회. 그룹 구성원만.
import { handle } from '@/lib/auth'
import { getVersion, requireTripMember } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ id: string; vid: string }> }) {
  return handle(async () => {
    const { id, vid } = await params
    await requireTripMember(request, id)
    return getVersion({ tripId: id, versionId: vid })
  })
}
