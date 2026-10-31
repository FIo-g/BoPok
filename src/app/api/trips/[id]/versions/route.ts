// 직접 고친 일정·빠른 수정안을 새 버전으로 저장한다. 그룹 구성원만.
// AI가 짠 버전은 이 API가 아니라 src/lib/trips의 createVersion으로 저장한다 (같은 저장 함수를 쓴다).
import { handle, readJson } from '@/lib/auth'
import { SaveVersionRequestSchema } from '@/lib/contracts'
import { requireTripMember, saveVersion } from '@/lib/trips'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireTripMember(request, id)
    const input = await readJson(request, SaveVersionRequestSchema)
    return saveVersion({ tripId: id, input, userId: me.userId })
  })
}
