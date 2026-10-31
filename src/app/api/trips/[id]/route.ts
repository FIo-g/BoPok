// 여행 + 여행자 + 버전 목록 조회, 여행 정보 고치기. 그룹 구성원만 (아니면 403).
import { handle, readJson } from '@/lib/auth'
import { UpdateTripRequestSchema } from '@/lib/contracts'
import { getTripDetail, requireTripMember, updateTrip } from '@/lib/trips'

// Next.js 16에서는 주소 안의 값이 Promise로 온다 — await를 빼먹으면 id가 Promise 객체가 된다.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    return getTripDetail(id)
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    const patch = await readJson(request, UpdateTripRequestSchema, { allowEmpty: true })
    return updateTrip({ tripId: id, patch })
  })
}
