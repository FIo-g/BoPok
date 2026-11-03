// 여행 날짜의 날씨 예보 (기상청 단기예보·중기예보). 폭염은 경고로, 비·눈·추위·바람은 여행 준비 안내로 쓴다.
// 판정(걷기 조건)은 바꾸지 않는다 — 예보는 바뀔 수 있고, 걷는 시간·판정은 엔진에서만 나온다 (AGENTS 6장).
import { z } from 'zod'

// 강수 형태. 단기예보 PTY 코드(0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기)와 중기예보 날씨 글("흐리고 비/눈")을 같은 말로 맞춘다
export const PrecipKindSchema = z.enum(['none', 'rain', 'shower', 'sleet', 'snow'])
export type PrecipKind = z.infer<typeof PrecipKindSchema>

// 하늘 상태. 기상청 SKY 코드 1 맑음, 3 구름많음, 4 흐림
export const SkyKindSchema = z.enum(['clear', 'cloudy', 'overcast'])
export type SkyKind = z.infer<typeof SkyKindSchema>

// 기상청 정성 정보 범주 그대로 (단기예보 가이드 참고자료).
// 비: 약한 비 시간당 3mm 미만, 보통 비 3~15mm, 강한 비 15mm 이상 / 눈: 보통 눈 시간당 1cm 미만, 많은 눈 1cm 이상
// 바람: 약한 바람 4m/s 미만, 약간 강한 바람 4~9m/s, 강한 바람 9m/s 이상
export const RainLevelSchema = z.enum(['light', 'moderate', 'heavy'])
export type RainLevel = z.infer<typeof RainLevelSchema>
export const SnowLevelSchema = z.enum(['normal', 'heavy'])
export type SnowLevel = z.infer<typeof SnowLevelSchema>
export const WindLevelSchema = z.enum(['weak', 'moderate', 'strong'])
export type WindLevel = z.infer<typeof WindLevelSchema>

// 하루치 예보 요약. 비·바람은 여행하는 낮 시간(09~18시) 기준, 기온은 하루 최고·최저.
// 중기예보(4~10일 뒤)는 오전·오후 날씨 글과 최고·최저 기온만 있어서 비 양·바람·체감온도는 null이다.
export const WeatherForecastSchema = z.object({
  source: z.enum(['short', 'mid']), // short = 단기예보, mid = 중기예보
  issuedAt: z.string(), // 발표 시각 "2026-11-03T05:00+09:00"
  sky: SkyKindSchema.nullable(),
  precip: PrecipKindSchema,
  popMaxPct: z.number().int().min(0).max(100).nullable(), // 낮 시간 가장 높은 강수확률
  rainLevel: RainLevelSchema.nullable(),
  snowLevel: SnowLevelSchema.nullable(),
  windLevel: WindLevelSchema.nullable(),
  tempMaxC: z.number().nullable(),
  tempMinC: z.number().nullable(),
  // 여름(5~9월) 단기예보만: 기상청 여름철 체감온도 식(기온·습도)으로 구한 하루 가장 높은 값. 폭염 경고는 이 값으로 본다
  feelsMaxC: z.number().nullable(),
})
export type WeatherForecast = z.infer<typeof WeatherForecastSchema>

// 기상청 기상특보(특보현황조회) 가운데 대전에 걸린 것. 발효 중인 특보는 오늘에만, 예비특보는 그 날짜에 붙는다.
// 육지 여행에 상관있는 종류만 온다: 폭염·한파·호우·대설·강풍·태풍·황사 (풍랑·폭풍해일·건조·열대야는 뺀다)
export const WEATHER_ALERT_KINDS = ['폭염', '한파', '호우', '대설', '강풍', '태풍', '황사'] as const
export const WeatherAlertKindSchema = z.enum(WEATHER_ALERT_KINDS)
export type WeatherAlertKind = z.infer<typeof WeatherAlertKindSchema>
// advisory 주의보, warning 경보, severe 중대경보, preliminary 예비특보(앞으로 특보가 날 수 있다는 예고)
export const WeatherAlertGradeSchema = z.enum(['advisory', 'warning', 'severe', 'preliminary'])
export type WeatherAlertGrade = z.infer<typeof WeatherAlertGradeSchema>
export const WEATHER_ALERT_GRADE_LABEL: Record<WeatherAlertGrade, string> = {
  advisory: '주의보',
  warning: '경보',
  severe: '중대경보',
  preliminary: '예비특보',
}

export const WeatherAlertSchema = z.object({
  kind: WeatherAlertKindSchema,
  grade: WeatherAlertGradeSchema,
  when: z.string().max(20).nullable(), // 예비특보의 때 ("오후", "밤"). 발효 중인 특보는 null
  issuedAt: z.string(), // 특보현황 발표 시각 "2026-11-03T05:00+09:00"
})
export type WeatherAlert = z.infer<typeof WeatherAlertSchema>

// ok = 예보 있음, past = 지난 날, too_far = 아직 예보가 안 나온 날(10일 뒤보다 멀다), unavailable = 기상청 응답을 못 받음
export const WeatherDayStatusSchema = z.enum(['ok', 'past', 'too_far', 'unavailable'])
export type WeatherDayStatus = z.infer<typeof WeatherDayStatusSchema>

export const TripWeatherDaySchema = z.object({
  day: z.number().int().min(1),
  date: z.string(), // YYYY-MM-DD
  status: WeatherDayStatusSchema,
  forecast: WeatherForecastSchema.nullable(),
  alerts: z.array(WeatherAlertSchema).optional(), // 대전에 걸린 기상특보·예비특보. 없으면 칸이 없다
})
export type TripWeatherDay = z.infer<typeof TripWeatherDaySchema>

// GET /api/trips/[id]/weather. 여행 날짜가 없으면 days는 빈 배열
export const TripWeatherResponseSchema = z.object({
  days: z.array(TripWeatherDaySchema),
  checkedAt: z.string(), // 이 응답을 만든 시각 (ISO)
})
export type TripWeatherResponse = z.infer<typeof TripWeatherResponseSchema>

export const WEATHER_SOURCE_LABEL: Record<WeatherForecast['source'], string> = {
  short: '기상청 단기예보',
  mid: '기상청 중기예보',
}
// 중기예보가 10일 뒤까지 나온다 (기상청 중기예보 조회서비스 가이드)
export const WEATHER_FORECAST_DAYS_MAX = 10

// 화면에 띄우는 날씨 안내 한 묶음 (엔진 weatherCautions가 만든다).
// warning = 폭염처럼 몸이 위험할 수 있는 날, prep = 비·눈·추위·바람처럼 챙길 것이 있는 날
export type WeatherCaution = {
  kind: 'heat' | 'rain' | 'snow' | 'cold' | 'wind' | 'alert'
  level: 'warning' | 'prep'
  title: string
  tips: string[]
}
