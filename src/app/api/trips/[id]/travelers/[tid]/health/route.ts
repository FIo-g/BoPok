// 여행자 한 사람의 건강 정보 저장(PUT)과 지우기(DELETE). 그룹 구성원만 (아니면 403).
// 누가 고칠 수 있는지는 canEditHealth가 정한다: 계정이 연결된 여행자는 본인만, 계정 없는 여행자는 처음 입력한 사람만.
// 동의(consent: true)가 없으면 400이다. 지우기는 동의 철회라 바로 삭제하고 204로 답한다.
// 병·약 값은 로그와 에러 메시지에 넣지 않는다 — 에러 문구는 src/lib/health의 정해진 것만 나간다.
import { errorResponse, handle, readJson } from '@/lib/auth'
import { TravelerHealthInputSchema } from '@/lib/contracts'
import { deleteHealth, putHealth } from '@/lib/health'
import { requireTripMember } from '@/lib/trips'

type Params = { params: Promise<{ id: string; tid: string }> }

export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { id, tid } = await params
    const me = await requireTripMember(request, id)
    const input = await readJson(request, TravelerHealthInputSchema)
    return putHealth({ tripId: id, travelerId: tid, actorUserId: me.userId, input })
  })
}

export async function DELETE(request: Request, { params }: Params) {
  // handle은 늘 JSON 200으로 답해서, 본문 없는 204는 에러만 errorResponse로 바꿔 직접 만든다.
  try {
    const { id, tid } = await params
    const me = await requireTripMember(request, id)
    await deleteHealth({ tripId: id, travelerId: tid, actorUserId: me.userId })
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
