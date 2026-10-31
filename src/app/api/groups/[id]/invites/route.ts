// 초대 링크 만들기. 그룹장만 (설계 10.4).
import { handle, requireOwner } from '@/lib/auth'
import { createInvite } from '@/lib/groups'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireOwner(request, id)
    return createInvite({ groupId: id, userId: me.userId })
  })
}
