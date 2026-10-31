// 여행자 목록 통째로 저장. 그룹 구성원만.
import { handle, readJson } from '@/lib/auth'
import { PutTravelersRequestSchema } from '@/lib/contracts'
import { replaceTravelers, requireTripMember } from '@/lib/trips'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireTripMember(request, id)
    const body = await readJson(request, PutTravelersRequestSchema)
    // actorUserId를 넘기면 '본인과 연결된 여행자'의 filledBySelf를 서버가 true로 정한다.
    return replaceTravelers({ tripId: id, travelers: body.travelers, actorUserId: me.userId })
  })
}
