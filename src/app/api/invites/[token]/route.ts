// 초대 미리보기. 로그인 전에도 보여줘야 해서 권한 검사가 없다 —
// 그래서 그룹 이름만 돌려준다 (구성원 목록·여행은 담지 않는다).
import { handle } from '@/lib/auth'
import { previewInvite } from '@/lib/groups'

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await params
    return previewInvite({ token })
  })
}
