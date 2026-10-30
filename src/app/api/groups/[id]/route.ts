// 그룹 + 구성원 목록. 구성원만 볼 수 있다 (아니면 403).
import { handle, requireMember } from '@/lib/auth'
import { getGroupDetail } from '@/lib/groups'

// Next.js 16에서는 주소 안의 값이 Promise로 온다 — await를 빼먹으면 id가 Promise 객체가 된다.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireMember(request, id)
    // requireMember가 이미 알아낸 내 역할을 그대로 넘긴다 (다시 조회하지 않게).
    return getGroupDetail({ groupId: id, myRole: me.role })
  })
}
