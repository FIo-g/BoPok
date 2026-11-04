// 일차별 만족도 — 보기와 남기기. 그 여행 그룹의 구성원만 (설계 2026-11-02 4.3).
import { handle, readJson } from '@/lib/auth'
import { DayFeedbackInputSchema } from '@/lib/contracts'
import { listDayFeedback, requireTripMember, saveDayFeedback } from '@/lib/trips'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    return listDayFeedback(id)
  })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const me = await requireTripMember(request, id)
    const input = await readJson(request, DayFeedbackInputSchema)
    return saveDayFeedback({ tripId: id, userId: me.userId, userName: me.userName, input })
  })
}
