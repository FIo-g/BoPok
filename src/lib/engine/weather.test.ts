import { describe, expect, it } from 'vitest'
import type { WeatherForecast } from '@/lib/contracts'
import { summerFeelsLikeC, weatherAiLine, weatherCautions, weatherSummaryParts } from './weather'

const forecast = (patch: Partial<WeatherForecast> = {}): WeatherForecast => ({
  source: 'short',
  issuedAt: '2026-11-03T05:00+09:00',
  sky: 'clear',
  precip: 'none',
  popMaxPct: 10,
  rainLevel: null,
  snowLevel: null,
  windLevel: 'weak',
  tempMaxC: 18,
  tempMinC: 7,
  feelsMaxC: null,
  ...patch,
})

describe('summerFeelsLikeC', () => {
  // Stull(2011) 논문의 예: 기온 20℃·습도 50% → 습구온도 13.7℃. 그 값을 넣은 기상청 식의 결과
  it('기상청 여름철 체감온도 식의 값', () => {
    expect(summerFeelsLikeC(20, 50)).toBe(19.8)
    expect(summerFeelsLikeC(33, 60)).toBe(33.5)
    expect(summerFeelsLikeC(33, 80)).toBe(35.2)
  })

  it('습도가 높으면 같은 기온이라도 더 덥게 느낀다', () => {
    expect(summerFeelsLikeC(31, 80)).toBeGreaterThan(summerFeelsLikeC(31, 50))
  })
})

describe('weatherCautions', () => {
  it('특별한 것이 없으면 아무 안내도 없다', () => {
    expect(weatherCautions(forecast(), { outdoorStops: 2 })).toEqual([])
  })

  it('체감온도 33℃ 이상이면 폭염 경고가 맨 앞에 온다', () => {
    const cautions = weatherCautions(forecast({ feelsMaxC: 33.4, tempMaxC: 32, precip: 'shower', popMaxPct: 60 }), { outdoorStops: 1 })
    expect(cautions.map(c => [c.kind, c.level])).toEqual([
      ['heat', 'warning'],
      ['rain', 'prep'],
    ])
    expect(cautions[0].title).toBe('폭염 주의 — 체감온도 33℃, 폭염주의보 기준만큼 더운 날이에요')
    expect(cautions[0].tips).toContain('이날 일정에 야외 장소가 1곳 있어요. 한낮을 피해 오전이나 해 질 무렵으로 옮겨 보세요.')
  })

  it('체감온도 35℃ 이상이면 폭염경보 기준', () => {
    const [heat] = weatherCautions(forecast({ feelsMaxC: 35.2 }), { outdoorStops: 0 })
    expect(heat.title).toContain('폭염경보 기준')
    expect(heat.tips.join(' ')).not.toContain('야외 장소')
  })

  it('체감온도가 없으면(중기예보) 최고기온으로 본다', () => {
    const [heat] = weatherCautions(forecast({ source: 'mid', feelsMaxC: null, tempMaxC: 34 }), { outdoorStops: 0 })
    expect(heat.title).toBe('폭염 주의 — 최고기온 34℃, 폭염주의보 기준만큼 더운 날이에요')
  })

  it('체감온도가 33℃ 아래면 최고기온이 높아도 경고하지 않는다', () => {
    expect(weatherCautions(forecast({ feelsMaxC: 32.4, tempMaxC: 33 }), { outdoorStops: 0 })).toEqual([])
  })

  it('화면에 보이는 정수로 비교한다 (32.5℃는 33℃로 보이므로 경고)', () => {
    expect(weatherCautions(forecast({ feelsMaxC: 32.5 }), { outdoorStops: 0 }).map(c => c.kind)).toEqual(['heat'])
  })

  it('비는 준비 안내이고 강수확률과 야외 장소 수를 적는다', () => {
    const [rain] = weatherCautions(forecast({ sky: 'overcast', precip: 'rain', popMaxPct: 70, rainLevel: 'moderate' }), { outdoorStops: 2 })
    expect(rain).toMatchObject({ kind: 'rain', level: 'prep', title: '비 소식 · 비 올 확률 70%' })
    expect(rain.tips).toContain('이날 일정에 야외 장소가 2곳 있어요. 실내 장소로 바꿀지 가족과 이야기해 보세요.')
  })

  it('강한 비는 이름을 바꾼다', () => {
    const [rain] = weatherCautions(forecast({ precip: 'rain', popMaxPct: 90, rainLevel: 'heavy' }), { outdoorStops: 1 })
    expect(rain.title).toBe('많은 비 소식 (시간당 15mm 이상) · 비 올 확률 90%')
  })

  it('눈·비/눈은 눈 안내, 영하면 추위 안내가 같이 온다', () => {
    const cautions = weatherCautions(forecast({ precip: 'sleet', popMaxPct: 60, tempMinC: -3, tempMaxC: 2 }), { outdoorStops: 0 })
    expect(cautions.map(c => c.kind)).toEqual(['snow', 'cold'])
    expect(cautions[0].title).toBe('비나 눈 소식 · 강수 확률 60%')
    expect(cautions[1].title).toBe('아침 기온이 영하예요 — 최저 -3℃')
    expect(cautions.every(c => c.level === 'prep')).toBe(true)
  })

  it('최저 -12℃ 이하면 한파주의보 기준이라고 적는다', () => {
    const [cold] = weatherCautions(forecast({ tempMinC: -12, tempMaxC: -4 }), { outdoorStops: 0 })
    expect(cold.title).toBe('매우 추운 날 — 최저 -12℃, 한파주의보 기준만큼 추워요')
  })

  it('강한 바람(9m/s 이상)만 바람 안내를 띄운다', () => {
    expect(weatherCautions(forecast({ windLevel: 'moderate' }), { outdoorStops: 0 })).toEqual([])
    expect(weatherCautions(forecast({ windLevel: 'strong' }), { outdoorStops: 0 }).map(c => c.kind)).toEqual(['wind'])
  })
})

describe('weatherSummaryParts', () => {
  it('하늘·비·기온·확률을 모르는 값 없이 적는다', () => {
    expect(weatherSummaryParts(forecast({ sky: 'overcast', precip: 'rain', popMaxPct: 70 }))).toEqual(['흐림, 비', '최고 18℃', '최저 7℃', '비 올 확률 70%'])
    expect(weatherSummaryParts(forecast({ sky: null, tempMinC: null, popMaxPct: null, feelsMaxC: 33.4 }))).toEqual(['최고 18℃', '체감 최고 33℃'])
    expect(weatherSummaryParts(forecast({ precip: 'snow', popMaxPct: 60 }))).toContain('강수 확률 60%')
  })
})

describe('weatherAiLine', () => {
  it('비·눈·폭염·한파인 날만 적는다', () => {
    const line = weatherAiLine(
      [
        { day: 1, forecast: forecast({ precip: 'rain' }) },
        { day: 2, forecast: forecast() },
        { day: 3, forecast: forecast({ feelsMaxC: 34 }) },
        { day: 4, forecast: null },
      ],
      true,
    )
    expect(line).toBe(
      '날씨 예보(기상청): 1일차 비, 3일차 폭염 — 그날은 실내 장소를 많이 넣고 야외 장소는 짧게 잡아라. 폭염인 날은 한낮(12~17시)에 야외 장소를 넣지 마라.',
    )
  })

  it('하루 여행이면 "여행 날"이라고 쓰고, 특별한 날이 없으면 null', () => {
    expect(weatherAiLine([{ day: 1, forecast: forecast({ precip: 'snow', tempMinC: -13 }) }], false)).toBe(
      '날씨 예보(기상청): 여행 날 눈·한파 — 그날은 실내 장소를 많이 넣고 야외 장소는 짧게 잡아라.',
    )
    expect(weatherAiLine([{ day: 1, forecast: forecast() }], false)).toBeNull()
  })
})
