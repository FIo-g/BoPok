// 기상청 응답 → 하루치 예보 요약 (WeatherForecast). 값의 뜻은 단기예보·중기예보 API 활용가이드의 코드표를 따른다.
// 모르는 값은 null로 두고 지어내지 않는다.
import 'server-only'
import { z } from 'zod'
import type { PrecipKind, RainLevel, SkyKind, SnowLevel, WeatherForecast, WindLevel } from '@/lib/contracts'
import { SUMMER_MONTHS, summerFeelsLikeC } from '@/lib/engine'
import { addDays, dashed, daysBetween, issuedAtOf } from './time'

// 여행하는 낮 시간. 비·바람·하늘은 이 시간만 본다 (밤에 오는 비로 낮 일정을 바꾸지 않게)
const DAY_HOURS = { from: 9, to: 18 }

const ValueSchema = z.union([z.string(), z.number()]).transform(value => String(value).trim())

export const ShortItemSchema = z.object({
  baseDate: z.string(),
  baseTime: z.string(),
  category: z.string(),
  fcstDate: z.string().regex(/^\d{8}$/),
  fcstTime: z.string().regex(/^\d{4}$/),
  fcstValue: ValueSchema,
})
export type ShortItem = z.infer<typeof ShortItemSchema>

// 결측: +900 이상, -900 이하 (가이드 코드값 정보)
function numberOf(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed >= 900 || parsed <= -900) return null
  return parsed
}

const PRECIP_RANK: Record<PrecipKind, number> = { none: 0, shower: 1, rain: 2, sleet: 3, snow: 4 }
const strongerPrecip = (a: PrecipKind, b: PrecipKind): PrecipKind => (PRECIP_RANK[b] > PRECIP_RANK[a] ? b : a)
const SKY_RANK: Record<SkyKind, number> = { clear: 0, cloudy: 1, overcast: 2 }

// 단기예보 PTY: 없음(0), 비(1), 비/눈(2), 눈(3), 소나기(4)
const PTY: Record<string, PrecipKind> = { '0': 'none', '1': 'rain', '2': 'sleet', '3': 'snow', '4': 'shower' }
// SKY: 맑음(1), 구름많음(3), 흐림(4)
const SKY: Record<string, SkyKind> = { '1': 'clear', '3': 'cloudy', '4': 'overcast' }

const RAIN_RANK: Record<RainLevel, number> = { light: 0, moderate: 1, heavy: 2 }
const WIND_RANK: Record<WindLevel, number> = { weak: 0, moderate: 1, strong: 2 }

// 1시간 강수량(PCP). 정량: "강수없음", "1mm 미만", "6.2mm", "30.0~50.0mm", "50.0mm 이상".
// 연장 기간(정성): 1 약한 비(3mm 미만), 2 보통 비(3~15mm), 3 강한 비(15mm 이상)
export function rainLevelOf(value: string, qualitative: boolean): RainLevel | null {
  if (value.includes('강한')) return 'heavy'
  if (value.includes('보통')) return 'moderate'
  if (value.includes('약한')) return 'light'
  if (qualitative) return ({ '1': 'light', '2': 'moderate', '3': 'heavy' } as Record<string, RainLevel>)[value] ?? null
  if (value.includes('미만')) return 'light'
  const mm = Number(value.match(/\d+(?:\.\d+)?/)?.[0] ?? NaN)
  if (!Number.isFinite(mm) || mm <= 0 || mm >= 900) return null
  return mm < 3 ? 'light' : mm < 15 ? 'moderate' : 'heavy'
}

// 1시간 신적설(SNO). 정량: "적설없음", "0.5cm 미만", "1.2cm", "5.0cm 이상". 연장 기간(정성): 1 보통 눈(1cm 미만), 2 많은 눈(1cm 이상)
export function snowLevelOf(value: string, qualitative: boolean): SnowLevel | null {
  if (value.includes('많은')) return 'heavy'
  if (value.includes('보통')) return 'normal'
  if (qualitative) return ({ '1': 'normal', '2': 'heavy' } as Record<string, SnowLevel>)[value] ?? null
  if (value.includes('미만')) return 'normal'
  const cm = Number(value.match(/\d+(?:\.\d+)?/)?.[0] ?? NaN)
  if (!Number.isFinite(cm) || cm <= 0 || cm >= 900) return null
  return cm < 1 ? 'normal' : 'heavy'
}

// 풍속(WSD) m/s. 연장 기간(정성): 1 약한 바람(4m/s 미만), 2 약간 강한 바람(4~9m/s), 3 강한 바람(9m/s 이상)
export function windLevelOf(value: string, qualitative: boolean): WindLevel | null {
  if (value.includes('약간 강한')) return 'moderate'
  if (value.includes('강한')) return 'strong'
  if (value.includes('약한')) return 'weak'
  if (qualitative) return ({ '1': 'weak', '2': 'moderate', '3': 'strong' } as Record<string, WindLevel>)[value] ?? null
  const mps = numberOf(value)
  if (mps === null || mps < 0) return null
  return mps < 4 ? 'weak' : mps < 9 ? 'moderate' : 'strong'
}

// 연장 기간: 02~14시 발표의 글피(3일 뒤), 17~23시 발표의 그글피(4일 뒤)는 3시간 간격이고 PCP·SNO·WSD가 정성 코드다
function isQualitative(fcstDate: string, baseDate: string, baseTime: string): boolean {
  const after = daysBetween(dashed(baseDate), dashed(fcstDate))
  return after >= (Number(baseTime.slice(0, 2)) <= 14 ? 3 : 4)
}

function maxBy<T>(values: T[], rank: Record<string, number>): T | null {
  let best: T | null = null
  for (const value of values) if (best === null || rank[String(value)] > rank[String(best)]) best = value
  return best
}

// 가장 많이 나온 하늘 상태. 같은 수면 더 흐린 쪽
function mostCommonSky(values: SkyKind[]): SkyKind | null {
  const counts = new Map<SkyKind, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: SkyKind | null = null
  for (const [sky, count] of counts) {
    const bestCount = best === null ? -1 : (counts.get(best) ?? 0)
    if (count > bestCount || (count === bestCount && best !== null && SKY_RANK[sky] > SKY_RANK[best])) best = sky
  }
  return best
}

// 단기예보 항목들 → 날짜('YYYY-MM-DD')별 요약
export function parseShortForecast(items: ShortItem[]): Map<string, WeatherForecast> {
  const byDate = new Map<string, ShortItem[]>()
  for (const item of items) byDate.set(item.fcstDate, [...(byDate.get(item.fcstDate) ?? []), item])

  const out = new Map<string, WeatherForecast>()
  for (const [fcstDate, dateItems] of byDate) {
    const { baseDate, baseTime } = dateItems[0]
    const qualitative = isQualitative(fcstDate, baseDate, baseTime)
    // 시각별 값. TMX·TMN은 하루 값이라 따로 둔다
    const hours = new Map<number, Map<string, string>>()
    let tmx: number | null = null
    let tmn: number | null = null
    for (const item of dateItems) {
      if (item.category === 'TMX') tmx = numberOf(item.fcstValue) ?? tmx
      else if (item.category === 'TMN') tmn = numberOf(item.fcstValue) ?? tmn
      else {
        const hour = Number(item.fcstTime.slice(0, 2))
        const row = hours.get(hour) ?? new Map<string, string>()
        row.set(item.category, item.fcstValue)
        hours.set(hour, row)
      }
    }
    const allRows = [...hours.values()]
    const dayRows = [...hours.entries()].filter(([hour]) => hour >= DAY_HOURS.from && hour <= DAY_HOURS.to).map(([, row]) => row)
    // 오늘 저녁처럼 낮 시간이 이미 지났으면 남은 시간으로 본다
    const rows = dayRows.length > 0 ? dayRows : allRows
    if (rows.length === 0 && tmx === null && tmn === null) continue

    const values = (category: string, from = rows) => from.flatMap(row => (row.has(category) ? [row.get(category) as string] : []))
    const precip = values('PTY').reduce<PrecipKind>((acc, code) => strongerPrecip(acc, PTY[code] ?? 'none'), 'none')
    const pops = values('POP').flatMap(value => {
      const pop = numberOf(value)
      return pop === null ? [] : [Math.max(0, Math.min(100, Math.round(pop)))]
    })
    const temps = values('TMP', allRows).flatMap(value => {
      const temp = numberOf(value)
      return temp === null ? [] : [temp]
    })
    const month = Number(fcstDate.slice(4, 6))
    const feels = SUMMER_MONTHS.includes(month)
      ? allRows.flatMap(row => {
          const temp = numberOf(row.get('TMP'))
          const humidity = numberOf(row.get('REH'))
          return temp === null || humidity === null ? [] : [summerFeelsLikeC(temp, humidity)]
        })
      : []

    const rainLevels = values('PCP').flatMap(value => rainLevelOf(value, qualitative) ?? [])
    const snowLevels = values('SNO').flatMap(value => snowLevelOf(value, qualitative) ?? [])
    const windLevels = values('WSD').flatMap(value => windLevelOf(value, qualitative) ?? [])

    out.set(dashed(fcstDate), {
      source: 'short',
      issuedAt: issuedAtOf(baseDate, baseTime),
      sky: mostCommonSky(values('SKY').flatMap(code => SKY[code] ?? [])),
      precip,
      popMaxPct: pops.length > 0 ? Math.max(...pops) : null,
      rainLevel: precip === 'none' || precip === 'snow' ? null : maxBy(rainLevels, RAIN_RANK),
      snowLevel: precip === 'snow' || precip === 'sleet' ? (snowLevels.length > 0 ? (snowLevels.includes('heavy') ? 'heavy' : 'normal') : null) : null,
      windLevel: maxBy(windLevels, WIND_RANK),
      tempMaxC: tmx ?? (temps.length > 0 ? Math.max(...temps) : null),
      tempMinC: tmn ?? (temps.length > 0 ? Math.min(...temps) : null),
      feelsMaxC: feels.length > 0 ? Math.max(...feels) : null,
    })
  }
  return out
}

// 중기예보 날씨 글: 맑음 / 구름많음, 구름많고 비·눈·비/눈·소나기 / 흐림, 흐리고 비·눈·비/눈·소나기
export function midWeatherOf(text: string): { sky: SkyKind | null; precip: PrecipKind } {
  const sky: SkyKind | null = text.startsWith('맑') ? 'clear' : text.startsWith('구름') ? 'cloudy' : text.startsWith('흐') ? 'overcast' : null
  const precip: PrecipKind = text.includes('비/눈')
    ? 'sleet'
    : text.includes('눈')
      ? 'snow'
      : text.includes('소나기')
        ? 'shower'
        : text.includes('비')
          ? 'rain'
          : 'none'
  return { sky, precip }
}

export const MidItemSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]))
export type MidItem = z.infer<typeof MidItemSchema>

const midString = (item: MidItem, key: string): string | null => {
  const value = item[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
const midNumber = (item: MidItem | null, key: string): number | null => {
  const value = item?.[key]
  if (value === undefined || value === null) return null
  return numberOf(String(value).trim())
}

// 중기 육상예보(하늘·비)와 중기 기온 → 날짜별 요약. tmFc는 발표 시각 'YYYYMMDDHHMM'이고 "n일 후"는 발표일 기준이다.
// 4~7일 뒤는 오전·오후가 따로, 8~10일 뒤는 하루 하나다. 06시 발표는 4일 뒤부터, 18시 발표는 5일 뒤부터 온다
export function parseMidForecast(land: MidItem, ta: MidItem | null, tmFc: string): Map<string, WeatherForecast> {
  const out = new Map<string, WeatherForecast>()
  const issuedDate = dashed(tmFc.slice(0, 8))
  for (let n = 4; n <= 10; n += 1) {
    const texts = n <= 7 ? [midString(land, `wf${n}Am`), midString(land, `wf${n}Pm`)] : [midString(land, `wf${n}`)]
    const known = texts.filter((text): text is string => text !== null)
    if (known.length === 0) continue
    const pops = (n <= 7 ? [`rnSt${n}Am`, `rnSt${n}Pm`] : [`rnSt${n}`]).flatMap(key => midNumber(land, key) ?? [])
    const parts = known.map(midWeatherOf)
    const skies = parts.flatMap(part => part.sky ?? [])
    out.set(addDays(issuedDate, n), {
      source: 'mid',
      issuedAt: issuedAtOf(tmFc.slice(0, 8), tmFc.slice(8, 12)),
      sky: maxBy(skies, SKY_RANK),
      precip: parts.reduce<PrecipKind>((acc, part) => strongerPrecip(acc, part.precip), 'none'),
      popMaxPct: pops.length > 0 ? Math.max(0, Math.min(100, Math.round(Math.max(...pops)))) : null,
      rainLevel: null,
      snowLevel: null,
      windLevel: null,
      tempMaxC: midNumber(ta, `taMax${n}`),
      tempMinC: midNumber(ta, `taMin${n}`),
      feelsMaxC: null,
    })
  }
  return out
}
