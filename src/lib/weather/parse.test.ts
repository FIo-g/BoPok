import { describe, expect, it } from 'vitest'
import { midWeatherOf, parseMidForecast, parseShortForecast, rainLevelOf, snowLevelOf, windLevelOf } from './parse'
import { MID_LAND_0600, MID_TA_0600, range, shortDayItems } from './test-fixtures'

describe('기상청 범주 읽기', () => {
  it('1시간 강수량(PCP)', () => {
    expect(rainLevelOf('강수없음', false)).toBeNull()
    expect(rainLevelOf('1mm 미만', false)).toBe('light')
    expect(rainLevelOf('2.9mm', false)).toBe('light')
    expect(rainLevelOf('6.2mm', false)).toBe('moderate')
    expect(rainLevelOf('30.0~50.0mm', false)).toBe('heavy')
    expect(rainLevelOf('50.0mm 이상', false)).toBe('heavy')
    // 연장 기간은 정성 코드다: 1 약한 비, 2 보통 비, 3 강한 비
    expect(rainLevelOf('3', true)).toBe('heavy')
    expect(rainLevelOf('2', true)).toBe('moderate')
    expect(rainLevelOf('강한 비', true)).toBe('heavy')
  })

  it('1시간 신적설(SNO)', () => {
    expect(snowLevelOf('적설없음', false)).toBeNull()
    expect(snowLevelOf('0.5cm 미만', false)).toBe('normal')
    expect(snowLevelOf('1.2cm', false)).toBe('heavy')
    expect(snowLevelOf('5.0cm 이상', false)).toBe('heavy')
    expect(snowLevelOf('2', true)).toBe('heavy')
  })

  it('풍속(WSD): 정량은 m/s, 연장 기간은 정성 코드', () => {
    expect(windLevelOf('3.5', false)).toBe('weak')
    expect(windLevelOf('4', false)).toBe('moderate')
    expect(windLevelOf('9.0', false)).toBe('strong')
    expect(windLevelOf('3', true)).toBe('strong')
    expect(windLevelOf('약간 강한 바람', true)).toBe('moderate')
    expect(windLevelOf('999', false)).toBeNull()
  })

  it('중기예보 날씨 글', () => {
    expect(midWeatherOf('맑음')).toEqual({ sky: 'clear', precip: 'none' })
    expect(midWeatherOf('구름많고 소나기')).toEqual({ sky: 'cloudy', precip: 'shower' })
    expect(midWeatherOf('흐리고 비/눈')).toEqual({ sky: 'overcast', precip: 'sleet' })
    expect(midWeatherOf('흐리고 눈')).toEqual({ sky: 'overcast', precip: 'snow' })
    expect(midWeatherOf('흐리고 비')).toEqual({ sky: 'overcast', precip: 'rain' })
  })
})

describe('parseShortForecast', () => {
  const base = { baseDate: '20261103', baseTime: '0500' }

  it('단기예보 기간 밖의 다음 날 0시 자료를 하루 최고·최저로 만들지 않는다', () => {
    const evening = { ...base, baseTime: '1700' }
    const parsed = parseShortForecast([
      ...shortDayItems({ ...evening, fcstDate: '20261107', hours: [9, 12, 15, 18], tmx: '9', tmn: '-1' }),
      ...shortDayItems({ ...evening, fcstDate: '20261108', hours: [0], values: () => ({ TMP: '1' }) }),
    ])
    expect(parsed.get('2026-11-07')).toMatchObject({ tempMaxC: 9, tempMinC: -1 })
    expect(parsed.has('2026-11-08')).toBe(false)
    const morning = parseShortForecast(shortDayItems({ ...base, fcstDate: '20261107', hours: [0], values: () => ({ TMP: '1' }) }))
    expect(morning.size).toBe(0)
  })

  it('낮 시간(9~18시)의 비만 보고, 기온은 하루 최고·최저(TMX·TMN)를 쓴다', () => {
    const items = shortDayItems({
      ...base,
      fcstDate: '20261104',
      hours: range(0, 23),
      tmx: '17.0',
      tmn: '6.0',
      values: hour =>
        hour === 15
          ? { PTY: '1', POP: '70', PCP: '6.2mm', SKY: '4' }
          : hour === 22
            ? { PTY: '3', POP: '90', SNO: '1.2cm' } // 밤 눈은 낮 일정과 상관없다
            : hour >= 9 && hour <= 18
              ? { SKY: '4', POP: '30' }
              : {},
    })
    const forecast = parseShortForecast(items).get('2026-11-04')
    expect(forecast).toEqual({
      source: 'short',
      issuedAt: '2026-11-03T05:00+09:00',
      sky: 'overcast',
      precip: 'rain',
      popMaxPct: 70,
      rainLevel: 'moderate',
      snowLevel: null,
      windLevel: 'weak',
      tempMaxC: 17,
      tempMinC: 6,
      feelsMaxC: null, // 11월은 여름철 체감온도를 쓰지 않는다
    })
  })

  it('TMX·TMN이 없으면 시각별 기온에서 고른다', () => {
    const items = shortDayItems({ ...base, fcstDate: '20261103', hours: range(6, 23), values: hour => ({ TMP: String(hour) }) })
    expect(parseShortForecast(items).get('2026-11-03')).toMatchObject({ tempMaxC: 23, tempMinC: 6 })
  })

  it('여름에는 기온·습도로 체감온도를 구한다', () => {
    const items = shortDayItems({
      baseDate: '20260804',
      baseTime: '0500',
      fcstDate: '20260805',
      hours: range(0, 23),
      tmx: '33.0',
      values: hour => (hour === 14 ? { TMP: '33', REH: '60' } : { TMP: '28', REH: '70' }),
    })
    expect(parseShortForecast(items).get('2026-08-05')?.feelsMaxC).toBe(33.5)
  })

  it('연장 기간(05시 발표의 글피)은 풍속이 정성 코드다', () => {
    const extended = shortDayItems({ ...base, fcstDate: '20261106', hours: [9, 12, 15, 18], values: () => ({ WSD: '3' }) })
    const normal = shortDayItems({ ...base, fcstDate: '20261105', hours: [9, 12, 15, 18], values: () => ({ WSD: '3' }) })
    const parsed = parseShortForecast([...extended, ...normal])
    expect(parsed.get('2026-11-06')?.windLevel).toBe('strong')
    expect(parsed.get('2026-11-05')?.windLevel).toBe('weak')
  })

  it('결측값(+900 이상)은 버린다', () => {
    const items = shortDayItems({ ...base, fcstDate: '20261104', hours: [12], values: () => ({ TMP: '999', POP: '-999' }) })
    expect(parseShortForecast(items).get('2026-11-04')).toMatchObject({ tempMaxC: null, tempMinC: null, popMaxPct: null })
  })

  it('비/눈이면 비 양과 눈 양을 함께 본다', () => {
    const items = shortDayItems({ ...base, fcstDate: '20261104', hours: [12], values: () => ({ PTY: '2', PCP: '1mm 미만', SNO: '0.5cm 미만' }) })
    expect(parseShortForecast(items).get('2026-11-04')).toMatchObject({ precip: 'sleet', rainLevel: 'light', snowLevel: 'normal' })
  })
})

describe('parseMidForecast', () => {
  it('발표일 기준 n일 뒤로 날짜를 매기고, 오전·오후 중 더 궂은 쪽을 쓴다', () => {
    const parsed = parseMidForecast(MID_LAND_0600, MID_TA_0600, '202611030600')
    expect([...parsed.keys()]).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
    expect(parsed.get('2026-11-07')).toEqual({
      source: 'mid',
      issuedAt: '2026-11-03T06:00+09:00',
      sky: 'overcast',
      precip: 'rain',
      popMaxPct: 60,
      rainLevel: null,
      snowLevel: null,
      windLevel: null,
      tempMaxC: 14,
      tempMinC: 6,
      feelsMaxC: null,
    })
    expect(parsed.get('2026-11-09')).toMatchObject({ precip: 'snow', popMaxPct: 80, tempMinC: -1 })
    expect(parsed.get('2026-11-12')).toMatchObject({ sky: 'cloudy', precip: 'shower', popMaxPct: 30 })
  })

  it('18시 발표에는 4일 뒤가 없고, 기온을 못 받으면 기온만 비운다', () => {
    const { wf4Am, wf4Pm, rnSt4Am, rnSt4Pm, ...land1800 } = MID_LAND_0600
    void [wf4Am, wf4Pm, rnSt4Am, rnSt4Pm]
    const parsed = parseMidForecast(land1800, null, '202611031800')
    expect(parsed.has('2026-11-07')).toBe(false)
    expect(parsed.get('2026-11-08')).toMatchObject({ issuedAt: '2026-11-03T18:00+09:00', sky: 'clear', tempMaxC: null, tempMinC: null })
  })
})
