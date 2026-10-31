// 초대 수락(참가). 로그인 필요. 이미 구성원이면 그대로 성공한다.
import { handle, readJson, requireUser } from '@/lib/auth'
import { AcceptInviteRequestSchema } from '@/lib/contracts'
import { acceptInvite } from '@/lib/groups'

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await params
    const me = await requireUser(request)
    // relation은 선택 — 몸체가 아예 없어도 된다.
    const body = await readJson(request, AcceptInviteRequestSchema, { allowEmpty: true })
    return acceptInvite({ token, userId: me.userId, relation: body.relation })
  })
}
