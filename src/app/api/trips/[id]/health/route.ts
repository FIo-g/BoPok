// 건강 정보 목록. 그룹 구성원만 (아니면 403).
// 보는 사람이 볼 수 있는 항목만 내려준다 — "본인만"은 값이 비어서 오는 것이 아니라 배열에 아예 없다 (canSeeHealth).
import { handle } from '@/lib/auth'
import { listVisibleHealth } from '@/lib/health'
import { requireTripMember } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireTripMember(request, id)
    return { health: await listVisibleHealth(id, me.userId) }
  })
}
