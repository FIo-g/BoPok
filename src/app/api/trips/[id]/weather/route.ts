// 여행 날짜별 날씨 예보 (기상청 단기·중기예보, 대전 기준). 그룹 구성원만 (아니면 403).
// 예보를 못 받은 날은 unavailable로 오고 500을 내지 않는다 — 날씨 때문에 일정 화면이 막히지 않게 한다.
import { handle } from '@/lib/auth'
import { getTrip, requireTripMember } from '@/lib/trips'
import { tripWeather } from '@/lib/weather'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    await requireTripMember(request, id)
    const trip = await getTrip(id)
    return tripWeather({ date: trip.date, endDate: trip.endDate })
  })
}
