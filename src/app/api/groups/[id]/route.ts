// 그룹 + 구성원 목록. 구성원만 볼 수 있다 (아니면 403).
import { handle, requireMember } from '@/lib/auth'
import { getGroupDetail } from '@/lib/groups'

// Next.js 16에서는 주소 안의 값이 Promise로 온다 — await를 빼먹으면 id가 Promise 객체가 된다.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    // 구성원인지 먼저 막는다. 화면은 응답의 ownerId와 내 id를 비교해 그룹장인지 판단한다.
    await requireMember(request, id)
    return getGroupDetail({ groupId: id })
  })
}
