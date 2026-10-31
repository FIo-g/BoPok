// 버전 확정·확정 풀기. 그룹 구성원 누구나 (설계 10.4).
// 확정은 여행당 한 버전 — 다른 버전을 확정하면 이전 확정은 자동으로 풀린다.
import { handle, readJson } from '@/lib/auth'
import { ConfirmRequestSchema } from '@/lib/contracts'
import { confirmVersion, requireTripMember, unconfirmVersion } from '@/lib/trips'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireTripMember(request, id)
    const body = await readJson(request, ConfirmRequestSchema)
    return confirmVersion({ tripId: id, versionId: body.versionId, userId: me.userId })
  })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    return unconfirmVersion(id)
  })
}
