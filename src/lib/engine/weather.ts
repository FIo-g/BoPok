// 날씨 예보 → 화면 안내·AI 참고 줄 (순수 함수). 폭염은 경고, 비·눈·추위·바람은 여행 준비 안내다.
// 판정(judge)에는 쓰지 않는다 — 예보는 바뀔 수 있어서 걷기 조건을 바꾸지 않고 띄우기만 한다.
// 기준 숫자는 기상청 특보 기준과 단기예보 범주에서 왔다 (근거 노트 docs/superpowers/specs/evidence/2026-11-03-weather.md).
import type { PrecipKind, SkyKind, TripWeatherDay, WeatherCaution, WeatherForecast } from '@/lib/contracts'

// 기상청 폭염특보: 일 최고 체감온도 33℃ 이상(주의보)·35℃ 이상(경보)이 2일 이상 이어질 것으로 예상될 때.
// 우리는 하루 예보만 보므로 "특보가 났다"가 아니라 "주의보 기준만큼 덥다"고 말한다
export const HEAT_WATCH_FEELS_C = 33
export const HEAT_WARNING_FEELS_C = 35
// 기상청 한파특보: 아침 최저기온 -12℃ 이하(주의보)가 2일 이상 이어질 것으로 예상될 때 (10월~4월)
export const COLD_WAVE_MIN_C = -12
// 영하면 그늘진 길·계단이 얼 수 있다
export const FREEZING_MIN_C = 0
// 여름철 체감온도 식을 쓰는 달 (기상청은 5~9월에 여름철 체감온도를 낸다)
export const SUMMER_MONTHS: readonly number[] = [5, 6, 7, 8, 9]

// 기상청 여름철 체감온도 (2022.6.2.~). 습구온도(Tw)는 Stull(2011) 추정식으로 기온·상대습도에서 구한다.
// 식은 기상청 기상자료개방포털의 체감온도 안내에 실린 것이다. 소수 첫째 자리로 반올림한다
export function summerFeelsLikeC(tempC: number, humidityPct: number): number {
  const ta = tempC
  const rh = humidityPct
  const tw =
    ta * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(ta + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  const feels = -0.2442 + 0.55399 * tw + 0.45535 * ta - 0.0022 * tw * tw + 0.00278 * tw * ta + 3.0
  return Math.round(feels * 10) / 10
}

const SKY_LABEL: Record<SkyKind, string> = { clear: '맑음', cloudy: '구름많음', overcast: '흐림' }
const PRECIP_LABEL: Record<Exclude<PrecipKind, 'none'>, string> = { rain: '비', shower: '소나기', sleet: '비 또는 눈', snow: '눈' }

const degrees = (value: number): string => `${Math.round(value)}℃`

// "흐리고 비 · 최고 18℃ · 최저 9℃ · 비 올 확률 70%" 의 조각들. 모르는 값은 빼고, 지어내지 않는다
export function weatherSummaryParts(forecast: WeatherForecast): string[] {
  const parts: string[] = []
  const sky = forecast.sky ? SKY_LABEL[forecast.sky] : null
  if (forecast.precip !== 'none') parts.push(sky ? `${sky}, ${PRECIP_LABEL[forecast.precip]}` : PRECIP_LABEL[forecast.precip])
  else if (sky) parts.push(sky)
  if (forecast.tempMaxC !== null) parts.push(`최고 ${degrees(forecast.tempMaxC)}`)
  if (forecast.tempMinC !== null) parts.push(`최저 ${degrees(forecast.tempMinC)}`)
  if (forecast.feelsMaxC !== null) parts.push(`체감 최고 ${degrees(forecast.feelsMaxC)}`)
  // 눈이 올 날에 "비 올 확률"이라고 하면 헷갈려서 그때는 "강수 확률"이라고 쓴다
  const snowy = forecast.precip === 'snow' || forecast.precip === 'sleet'
  if (forecast.popMaxPct !== null) parts.push(`${snowy ? '강수 확률' : '비 올 확률'} ${forecast.popMaxPct}%`)
  return parts
}

// 폭염은 체감온도로 본다. 체감온도가 없는 날(중기예보, 여름이 아닌 달)은 최고기온으로 본다 — 습도를 모르면 이것이 가장 가깝다.
// 화면에 보이는 정수(반올림)로 비교한다 — "33℃"라고 보이는데 경고가 없으면 헷갈린다 (덥다고 보는 쪽으로 반올림된다)
function heatValue(forecast: WeatherForecast): { value: number; label: string } | null {
  if (forecast.feelsMaxC !== null) return { value: Math.round(forecast.feelsMaxC), label: '체감온도' }
  if (forecast.tempMaxC !== null) return { value: Math.round(forecast.tempMaxC), label: '최고기온' }
  return null
}

function outdoorTip(outdoorStops: number, then: string): string[] {
  return outdoorStops > 0 ? [`이날 일정에 야외 장소가 ${outdoorStops}곳 있어요. ${then}`] : []
}

function heatCaution(forecast: WeatherForecast, outdoorStops: number): WeatherCaution | null {
  const heat = heatValue(forecast)
  if (!heat || heat.value < HEAT_WATCH_FEELS_C) return null
  const grade = heat.value >= HEAT_WARNING_FEELS_C ? '폭염경보' : '폭염주의보'
  return {
    kind: 'heat',
    level: 'warning',
    title: `폭염 주의 — ${heat.label} ${degrees(heat.value)}, ${grade} 기준만큼 더운 날이에요`,
    // 질병관리청 폭염 건강수칙: 물 자주 마시기, 시원한 곳에서 쉬기, 가장 더운 12~17시 야외활동 줄이기. 옷차림은 보건복지부 권고
    tips: [
      '목마르지 않아도 물을 자주 드세요.',
      '가장 더운 낮 12시~5시에는 실내 장소에서 쉬어 가세요.',
      '모자나 양산을 챙기고, 밝고 헐렁한 옷을 입으세요.',
      ...outdoorTip(outdoorStops, '한낮을 피해 오전이나 해 질 무렵으로 옮겨 보세요.'),
      '어지럽거나 속이 메스꺼우면 바로 시원한 곳에서 쉬세요.',
    ],
  }
}

function rainCaution(forecast: WeatherForecast, outdoorStops: number): WeatherCaution | null {
  if (forecast.precip !== 'rain' && forecast.precip !== 'shower') return null
  const pop = forecast.popMaxPct !== null ? ` · 비 올 확률 ${forecast.popMaxPct}%` : ''
  const heavy = forecast.rainLevel === 'heavy'
  const name = heavy ? '많은 비 소식 (시간당 15mm 이상)' : forecast.precip === 'shower' ? '소나기 소식' : '비 소식'
  return {
    kind: 'rain',
    level: 'prep',
    title: `${name}${pop}`,
    tips: [
      '우산이나 우비를 챙겨 주세요.',
      '젖은 계단과 경사로는 미끄러워요. 손잡이를 잡고 천천히 걸으세요.',
      ...outdoorTip(outdoorStops, heavy ? '비가 많이 오면 실내 장소로 바꾸는 게 좋아요.' : '실내 장소로 바꿀지 가족과 이야기해 보세요.'),
    ],
  }
}

function snowCaution(forecast: WeatherForecast, outdoorStops: number): WeatherCaution | null {
  if (forecast.precip !== 'snow' && forecast.precip !== 'sleet') return null
  const pop = forecast.popMaxPct !== null ? ` · 강수 확률 ${forecast.popMaxPct}%` : ''
  const name = forecast.snowLevel === 'heavy' ? '많은 눈 소식 (시간당 1cm 이상)' : forecast.precip === 'sleet' ? '비나 눈 소식' : '눈 소식'
  return {
    kind: 'snow',
    level: 'prep',
    title: `${name}${pop}`,
    tips: [
      '바닥이 미끄럽지 않은 신발을 신어 주세요.',
      '눈 쌓인 계단과 경사로는 피하고, 천천히 걸으세요.',
      ...outdoorTip(outdoorStops, '길이 미끄러우면 실내 장소로 바꾸는 게 좋아요.'),
    ],
  }
}

function coldCaution(forecast: WeatherForecast): WeatherCaution | null {
  if (forecast.tempMinC === null || forecast.tempMinC > FREEZING_MIN_C) return null
  const wave = forecast.tempMinC <= COLD_WAVE_MIN_C
  return {
    kind: 'cold',
    level: 'prep',
    title: wave
      ? `매우 추운 날 — 최저 ${degrees(forecast.tempMinC)}, 한파주의보 기준만큼 추워요`
      : `아침 기온이 영하예요 — 최저 ${degrees(forecast.tempMinC)}`,
    tips: [
      '두꺼운 옷을 여러 겹 입고 모자·장갑·목도리를 챙겨 주세요.',
      '그늘진 길과 계단은 얼어 있을 수 있어요.',
      ...(wave ? ['아침 일찍보다 해가 난 뒤에 나서고, 실내에서 자주 몸을 녹이세요.'] : []),
    ],
  }
}

function windCaution(forecast: WeatherForecast): WeatherCaution | null {
  if (forecast.windLevel !== 'strong') return null
  return {
    kind: 'wind',
    level: 'prep',
    title: '바람이 강해요 (초속 9m 이상)',
    tips: ['모자는 끈이 있는 것으로 챙기고, 바람 때문에 더 춥게 느껴질 수 있어요.'],
  }
}

// 그날 예보로 띄울 안내. 경고(폭염)가 먼저 온다. 특별한 것이 없으면 빈 배열 — 그래도 "괜찮아요"라고 말하지 않는다
// (예보는 바뀔 수 있다). outdoorStops는 그날 일정의 야외 장소 수 (장소 정보의 indoor가 false인 것)
export function weatherCautions(forecast: WeatherForecast, opts: { outdoorStops: number }): WeatherCaution[] {
  const outdoor = Math.max(0, Math.floor(opts.outdoorStops))
  return [
    heatCaution(forecast, outdoor),
    rainCaution(forecast, outdoor),
    snowCaution(forecast, outdoor),
    coldCaution(forecast),
    windCaution(forecast),
  ].filter((caution): caution is WeatherCaution => caution !== null)
}

// AI가 일정을 짤 때 참고할 한 줄. 비·눈·폭염·한파인 날만 적고, 그런 날이 없으면 null.
// 걷는 시간·판정은 엔진이 따로 계산하므로, 이 줄은 실내·야외 장소를 고르는 참고일 뿐이다
export function weatherAiLine(days: readonly Pick<TripWeatherDay, 'day' | 'forecast'>[], multiDay: boolean): string | null {
  const notes: string[] = []
  let hasHeat = false
  for (const { day, forecast } of days) {
    if (!forecast) continue
    const words: string[] = []
    const heat = heatValue(forecast)
    if (heat && heat.value >= HEAT_WATCH_FEELS_C) {
      words.push('폭염')
      hasHeat = true
    }
    if (forecast.precip !== 'none') words.push(PRECIP_LABEL[forecast.precip])
    if (forecast.tempMinC !== null && forecast.tempMinC <= COLD_WAVE_MIN_C) words.push('한파')
    if (words.length > 0) notes.push(`${multiDay ? `${day}일차` : '여행 날'} ${words.join('·')}`)
  }
  if (notes.length === 0) return null
  return (
    `날씨 예보(기상청): ${notes.join(', ')} — 그날은 실내 장소를 많이 넣고 야외 장소는 짧게 잡아라.` +
    (hasHeat ? ' 폭염인 날은 한낮(12~17시)에 야외 장소를 넣지 마라.' : '')
  )
}
