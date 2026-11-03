// 여행 날짜별 날씨 (GET /api/trips/[id]/weather, AI 프롬프트 참고 줄).
// 오늘~3·4일 뒤는 단기예보, 4~10일 뒤는 중기예보, 그보다 멀면 "아직 예보 없음", 지난 날은 "지난 날".
// 예보를 못 받아도 던지지 않는다 — 그날만 unavailable로 두고 일정 화면·AI는 날씨 없이 계속한다.
import 'server-only'
import { WEATHER_FORECAST_DAYS_MAX, type TripWeatherDay, type TripWeatherResponse, type WeatherForecast } from '@/lib/contracts'
import { dayDate, tripDayList } from '@/lib/plan/trip-days'
import { WeatherError, fetchMidForecast, fetchShortForecast, type WeatherFetch } from './kma'
import { daysBetween, kstToday, midTmFc, shortBase } from './time'

// 단기예보는 4일 뒤(17~23시 발표의 그글피)까지 올 수 있다
const SHORT_DAYS_MAX = 4
const MID_DAYS_MIN = 4
// 같은 발표는 다시 받지 않는다. 발표가 바뀌면 열쇠가 바뀌므로 1시간이면 충분하다
const CACHE_TTL_MS = 60 * 60 * 1000
// 실패하면 1분 동안은 다시 부르지 않는다 (키 미등록 등으로 매 화면마다 기상청을 두드리지 않게)
const FAILURE_TTL_MS = 60 * 1000

export type WeatherDeps = {
  fetch: WeatherFetch
  now: () => Date
  serviceKey: string | undefined
}

export function defaultWeatherDeps(): WeatherDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    serviceKey: process.env.TOURAPI_SERVICE_KEY || undefined,
  }
}

type Entry = { value: Promise<Map<string, WeatherForecast>>; expiresAt: number }
const cache = new Map<string, Entry>()

// 테스트용
export function clearWeatherCache(): void {
  cache.clear()
}

function cached(key: string, nowMs: number, load: () => Promise<Map<string, WeatherForecast>>): Promise<Map<string, WeatherForecast>> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt > nowMs) return hit.value
  const entry: Entry = { value: load(), expiresAt: nowMs + CACHE_TTL_MS }
  entry.value.catch(() => {
    entry.expiresAt = Math.min(entry.expiresAt, nowMs + FAILURE_TTL_MS)
  })
  cache.set(key, entry)
  return entry.value
}

// 실패는 로그에 종류만 남긴다 (주소에 키가 있어 오류 객체·주소는 찍지 않는다)
async function quietly(kind: 'short' | 'mid', load: Promise<Map<string, WeatherForecast>>): Promise<Map<string, WeatherForecast> | null> {
  try {
    return await load
  } catch (error) {
    console.warn('[weather] 기상청 예보를 못 받았어요', { kind, code: error instanceof WeatherError ? error.code : 'unknown' })
    return null
  }
}

export async function tripWeather(
  dates: { date?: string | null; endDate?: string | null },
  deps: WeatherDeps = defaultWeatherDeps(),
): Promise<TripWeatherResponse> {
  const now = deps.now()
  const checkedAt = now.toISOString()
  if (!dates.date) return { days: [], checkedAt }

  const today = kstToday(now)
  const days = tripDayList({ date: dates.date, endDate: dates.endDate ?? null }, []).flatMap(day => {
    const date = dayDate(dates.date, day)
    return date ? [{ day, date, offset: daysBetween(today, date) }] : []
  })
  const needShort = days.some(d => d.offset >= 0 && d.offset <= SHORT_DAYS_MAX)
  const needMid = days.some(d => d.offset >= MID_DAYS_MIN && d.offset <= WEATHER_FORECAST_DAYS_MAX)
  const key = deps.serviceKey
  const nowMs = now.getTime()

  const [short, mid] = await Promise.all([
    needShort && key
      ? quietly('short', cached(`short:${Object.values(shortBase(now)).join('')}`, nowMs, () => fetchShortForecast(deps.fetch, key, now)))
      : null,
    needMid && key ? quietly('mid', cached(`mid:${midTmFc(now)}`, nowMs, () => fetchMidForecast(deps.fetch, key, now))) : null,
  ])

  // 받은 예보가 닿는 가장 먼 날. 그 뒤 날짜는 "아직 예보가 안 나온 날"이다 (예: 18시 중기예보는 10일 뒤까지만)
  const covered = [...(short?.keys() ?? []), ...(mid?.keys() ?? [])].sort().at(-1) ?? null
  const fetchedAll = (!needShort || short !== null) && (!needMid || mid !== null)

  return {
    checkedAt,
    days: days.map(({ day, date, offset }): TripWeatherDay => {
      if (offset < 0) return { day, date, status: 'past', forecast: null }
      if (offset > WEATHER_FORECAST_DAYS_MAX) return { day, date, status: 'too_far', forecast: null }
      const forecast = short?.get(date) ?? mid?.get(date) ?? null
      if (forecast) return { day, date, status: 'ok', forecast }
      if (key && fetchedAll && covered !== null && date > covered) return { day, date, status: 'too_far', forecast: null }
      return { day, date, status: 'unavailable', forecast: null }
    }),
  }
}
