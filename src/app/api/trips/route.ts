// 여행 만들기. 그 그룹의 구성원 누구나 (설계 10.4).
import { handle, readJson, requireMember, requireUser } from '@/lib/auth'
import { CreateTripRequestSchema } from '@/lib/contracts'
import { createTrip } from '@/lib/trips'

export async function POST(request: Request) {
  return handle(async () => {
    // 로그인부터 본다 — 안 한 사람이 잘못된 본문을 보내도 400이 아니라 401이어야 한다.
    await requireUser(request)
    const body = await readJson(request, CreateTripRequestSchema)
    // 여행이 아직 없으니 몸체의 groupId로 구성원인지 본다 (남의 그룹에 여행을 만들 수 없게).
    const me = await requireMember(request, body.groupId)
    return createTrip({ ...body, userId: me.userId })
  })
}
