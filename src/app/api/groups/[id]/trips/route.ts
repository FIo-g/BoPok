// 그룹의 여행 목록. 구성원만 (아니면 403).
// 여행마다 최신·확정 버전 요약이 붙는데, 버전 테이블은 4단계라 지금은 null이다.
import { handle, requireMember } from '@/lib/auth'
import { listGroupTrips } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireMember(request, id)
    return listGroupTrips(id)
  })
}
