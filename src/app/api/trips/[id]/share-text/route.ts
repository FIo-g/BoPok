// 확정 일정의 공유 글 (가족에게 보내기). 그룹 구성원만.
import { handle } from '@/lib/auth'
import { getShareText, requireTripMember } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    return getShareText(id)
  })
}
