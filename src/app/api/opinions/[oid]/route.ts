// 내 의견 지우기.
// 권한은 두 단계다: ① 지금도 그 그룹 구성원인지 ② 그다음 내 의견인지 (requireOwnOpinion).
// 그룹에서 내보내진 사람은 예전에 남긴 자기 의견도 지울 수 없다.
import { handle } from '@/lib/auth'
import { removeOpinion, requireOwnOpinion } from '@/lib/trips'

export async function DELETE(request: Request, { params }: { params: Promise<{ oid: string }> }) {
  return handle(async () => {
    const { oid } = await params
    await requireOwnOpinion(request, oid)
    await removeOpinion(oid)
    return { removed: true }
  })
}
