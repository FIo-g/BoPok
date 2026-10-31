// 구성원 내보내기. 그룹장만 (설계 10.4). 자기 자신은 내보낼 수 없다 (400).
import { handle, requireOwner } from '@/lib/auth'
import { removeMember } from '@/lib/groups'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  return handle(async () => {
    const { id, userId } = await params
    const me = await requireOwner(request, id)
    return removeMember({ groupId: id, targetUserId: userId, actorUserId: me.userId })
  })
}
