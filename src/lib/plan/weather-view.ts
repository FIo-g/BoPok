// 일정 화면 "날씨" 카드가 무엇을 보여 줄지 가르는 순수 도우미 (React·fetch 없음).
// 안내 문장은 엔진(dayWeatherCautions)이 만들고, 여기서는 고른 날을 찾아 출처 줄과 야외 장소 수를 붙인다.
import { placeKindOf, WEATHER_SOURCE_LABEL, type PlaceDetail, type Stop, type TripWeatherResponse, type WeatherCaution } from '@/lib/contracts'
import { dayWeatherCautions, weatherSummaryParts } from '@/lib/engine'

export type WeatherSlotView =
  | { kind: 'hidden' } // 지난 날이거나 여행 기간 밖의 날
  | { kind: 'no_date' }
  | { kind: 'message'; text: string }
  | { kind: 'forecast'; summary: string; warnings: WeatherCaution[]; preps: WeatherCaution[]; sourceLine: string }

const TOO_FAR_TEXT = '날씨 예보는 여행 10일 전부터 나와요. 가까워지면 다시 확인해 주세요.'
const UNAVAILABLE_TEXT = '지금은 기상청 예보를 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.'

// "2026-11-03T05:00+09:00" → "11월 3일 5시 발표"
function issuedText(issuedAt: string): string {
  const m = issuedAt.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return '발표 시각 모름'
  return `${Number(m[1])}월 ${Number(m[2])}일 ${Number(m[3])}시 발표`
}

// 그날 일정의 야외 관광지 수. 장소 정보가 없는 곳(직접 적은 곳)은 실내인지 몰라서 세지 않는다.
// 가져온 식당·카페·숙박은 indoor false가 '실내 아님'이 아니라 '미확인'이라 세지 않는다 (날씨 안내는 관광지 기준).
export function outdoorStopCount(stops: Stop[], places: Record<string, PlaceDetail>): number {
  return stops.filter(stop => {
    if (stop.placeId === null || !Object.hasOwn(places, stop.placeId)) return false
    const place = places[stop.placeId]
    return placeKindOf(place) === 'attraction' && place.indoor === false
  }).length
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
  const alerts = today.alerts ?? []
  const forecast = today.status === 'ok' ? today.forecast : null
  // 예보도 특보도 없으면 안내 글만
  if (!forecast && alerts.length === 0) return { kind: 'message', text: today.status === 'too_far' ? TOO_FAR_TEXT : UNAVAILABLE_TEXT }

  const cautions = dayWeatherCautions({ forecast, alerts }, { outdoorStops: outdoorStopCount(args.stops, args.places) })
  const sources = [
    ...(forecast ? [`${WEATHER_SOURCE_LABEL[forecast.source]} · ${issuedText(forecast.issuedAt)}`] : []),
    ...(alerts.length > 0 ? [`기상청 기상특보 · ${issuedText(alerts[0].issuedAt)}`] : []),
  ]
  return {
    kind: 'forecast',
    // 특보만 있고 예보가 없는 날은 왜 예보가 없는지 적는다
    summary: forecast ? weatherSummaryParts(forecast).join(' · ') : today.status === 'too_far' ? TOO_FAR_TEXT : UNAVAILABLE_TEXT,
    warnings: cautions.filter(c => c.level === 'warning'),
    preps: cautions.filter(c => c.level === 'prep'),
    sourceLine: `출처: ${sources.join(' / ')} · 대전 기준 · 예보는 바뀔 수 있어요`,
  }
}
