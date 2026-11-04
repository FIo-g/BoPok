// 가짜 날씨 예보 (NEXT_PUBLIC_USE_MOCKS=1). 화면이 맑은 날·비 오는 날·더운 날을 모두 보여 볼 수 있게 날마다 돌려 가며 준다.
// 숫자는 화면 확인용 가짜다 — 실제 예보가 아니다.
import { WEATHER_FORECAST_DAYS_MAX, type Trip, type TripWeatherDay, type TripWeatherResponse, type WeatherForecast } from '@/lib/contracts'
import { dayDate, tripDayList } from '@/lib/plan/trip-days'

const DAY_MS = 24 * 60 * 60 * 1000

const SAMPLES: Omit<WeatherForecast, 'issuedAt' | 'source'>[] = [
  { sky: 'clear', precip: 'none', popMaxPct: 10, rainLevel: null, snowLevel: null, windLevel: 'weak', tempMaxC: 19, tempMinC: 8, feelsMaxC: null },
  { sky: 'overcast', precip: 'rain', popMaxPct: 70, rainLevel: 'moderate', snowLevel: null, windLevel: 'moderate', tempMaxC: 15, tempMinC: 9, feelsMaxC: null },
  { sky: 'clear', precip: 'none', popMaxPct: 0, rainLevel: null, snowLevel: null, windLevel: 'weak', tempMaxC: 34, tempMinC: 25, feelsMaxC: 34.2 },
  { sky: 'overcast', precip: 'snow', popMaxPct: 60, rainLevel: null, snowLevel: 'normal', windLevel: 'strong', tempMaxC: 2, tempMinC: -4, feelsMaxC: null },
]

const ymd = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function mockTripWeather(trip: Pick<Trip, 'date' | 'endDate'>, now = new Date()): TripWeatherResponse {
  const checkedAt = now.toISOString()
  if (!trip.date) return { days: [], checkedAt }
  const today = Date.parse(`${ymd(now.getTime())}T00:00:00Z`)
  const issuedAt = `${ymd(now.getTime())}T05:00+09:00`
  return {
    checkedAt,
    days: tripDayList(trip, []).flatMap((day): TripWeatherDay[] => {
      const date = dayDate(trip.date, day)
      if (!date) return []
      const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - today) / DAY_MS)
      if (offset < 0) return [{ day, date, status: 'past', forecast: null }]
      if (offset > WEATHER_FORECAST_DAYS_MAX) return [{ day, date, status: 'too_far', forecast: null }]
      const sample = SAMPLES[(day - 1) % SAMPLES.length]
      const source = offset <= 3 ? 'short' : 'mid'
      // 중기예보에는 비 양·바람·체감온도가 없다 — 실제와 같은 모양으로 비운다
      const forecast: WeatherForecast =
        source === 'short'
          ? { ...sample, source, issuedAt }
          : { ...sample, source, issuedAt, rainLevel: null, snowLevel: null, windLevel: null, feelsMaxC: null }
      // 더운 날 견본에는 기상청 폭염 예비특보도 붙여 화면에서 특보 경고를 볼 수 있게 한다
      const alerts = sample.tempMaxC !== null && sample.tempMaxC >= 33 ? [{ kind: '폭염' as const, grade: 'preliminary' as const, when: '오후', issuedAt }] : []
      return [alerts.length > 0 ? { day, date, status: 'ok', forecast, alerts } : { day, date, status: 'ok', forecast }]
    }),
  }
}
