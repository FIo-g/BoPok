// 일정 화면 "날씨" 카드가 무엇을 보여 줄지 가르는 순수 도우미 (React·fetch 없음).
// 안내 문장은 엔진(weatherCautions)이 만들고, 여기서는 고른 날을 찾아 출처 줄과 야외 장소 수를 붙인다.
import { WEATHER_SOURCE_LABEL, type PlaceDetail, type Stop, type TripWeatherResponse, type WeatherCaution } from '@/lib/contracts'
import { weatherCautions, weatherSummaryParts } from '@/lib/engine'

export type WeatherSlotView =
  | { kind: 'hidden' } // 지난 날이거나 여행 기간 밖의 날
  | { kind: 'no_date' }
  | { kind: 'message'; text: string }
  | { kind: 'forecast'; summary: string; warnings: WeatherCaution[]; preps: WeatherCaution[]; sourceLine: string }

// "2026-11-03T05:00+09:00" → "11월 3일 5시 발표"
function issuedText(issuedAt: string): string {
  const m = issuedAt.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return '발표 시각 모름'
  return `${Number(m[1])}월 ${Number(m[2])}일 ${Number(m[3])}시 발표`
}

// 그날 일정의 야외 장소 수. 장소 정보가 없는 곳(직접 적은 곳)은 실내인지 몰라서 세지 않는다
export function outdoorStopCount(stops: Stop[], places: Record<string, PlaceDetail>): number {
  return stops.filter(stop => stop.placeId !== null && Object.hasOwn(places, stop.placeId) && places[stop.placeId].indoor === false).length
}

export function weatherSlotView(args: {
  weather: TripWeatherResponse
  day: number
  stops: Stop[]
  places: Record<string, PlaceDetail>
}): WeatherSlotView {
  if (args.weather.days.length === 0) return { kind: 'no_date' }
  const today = args.weather.days.find(d => d.day === args.day)
  if (!today || today.status === 'past') return { kind: 'hidden' }
  if (today.status === 'too_far') return { kind: 'message', text: '날씨 예보는 여행 10일 전부터 나와요. 가까워지면 다시 확인해 주세요.' }
  if (today.status === 'unavailable' || !today.forecast) {
    return { kind: 'message', text: '지금은 기상청 예보를 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.' }
  }
  const forecast = today.forecast
  const cautions = weatherCautions(forecast, { outdoorStops: outdoorStopCount(args.stops, args.places) })
  return {
    kind: 'forecast',
    summary: weatherSummaryParts(forecast).join(' · '),
    warnings: cautions.filter(c => c.level === 'warning'),
    preps: cautions.filter(c => c.level === 'prep'),
    sourceLine: `출처: ${WEATHER_SOURCE_LABEL[forecast.source]} · ${issuedText(forecast.issuedAt)} · 대전 기준 · 예보는 바뀔 수 있어요`,
  }
}
