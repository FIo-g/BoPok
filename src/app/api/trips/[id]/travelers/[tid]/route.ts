// 여행자 한 사람 고치기. 그룹 구성원만.
// 본인 계정과 연결된 여행자를 고치면 filledBySelf가 true가 된다 (서버가 정한다).
import { handle, readJson } from '@/lib/auth'
import { PatchTravelerRequestSchema } from '@/lib/contracts'
import { patchTraveler, requireTripMember } from '@/lib/trips'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; tid: string }> }) {
  return handle(async () => {
    const { id, tid } = await params
    const me = await requireTripMember(request, id)
    const patch = await readJson(request, PatchTravelerRequestSchema, { allowEmpty: true })
    return patchTraveler({ tripId: id, travelerId: tid, patch, actorUserId: me.userId })
  })
}
