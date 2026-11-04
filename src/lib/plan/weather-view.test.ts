import { describe, expect, it } from 'vitest'
import type { PlaceDetail, Stop, TripWeatherResponse, WeatherForecast } from '@/lib/contracts'
import { outdoorStopCount, weatherSlotView } from './weather-view'

const forecast = (patch: Partial<WeatherForecast> = {}): WeatherForecast => ({
  source: 'short',
  issuedAt: '2026-11-03T05:00+09:00',
  sky: 'overcast',
  precip: 'rain',
  popMaxPct: 70,
  rainLevel: 'moderate',
  snowLevel: null,
  windLevel: 'weak',
  tempMaxC: 15,
  tempMinC: 9,
  feelsMaxC: null,
  ...patch,
})

const weather = (days: TripWeatherResponse['days']): TripWeatherResponse => ({ days, checkedAt: '2026-11-03T01:00:00.000Z' })

const stop = (key: string, placeId: string | null): Stop => ({ key, placeId, name: key, visitMin: 60, arriveBy: 'car' }) as Stop
const place = (id: string, indoor: boolean) => ({ id, indoor }) as PlaceDetail
const placeOfKind = (id: string, indoor: boolean, kind: PlaceDetail['kind']) => ({ id, indoor, kind }) as PlaceDetail

describe('outdoorStopCount', () => {
  it('장소 정보에서 야외인 곳만 센다 (직접 적은 곳은 모른다)', () => {
    const places = { a: place('a', false), b: place('b', true) }
    expect(outdoorStopCount([stop('1', 'a'), stop('2', 'b'), stop('3', null), stop('4', 'x')], places)).toBe(1)
  })

  it('야외 관광지만 센다 — 식당·카페·숙박은 indoor false여도 미확인이라 안 센다', () => {
    const places = {
      r: placeOfKind('r', false, 'restaurant'),
      c: placeOfKind('c', false, 'cafe'),
      l: placeOfKind('l', false, 'lodging'),
      t: placeOfKind('t', false, 'attraction'),
    }
    expect(outdoorStopCount([stop('1', 'r'), stop('2', 'c'), stop('3', 'l'), stop('4', 't')], places)).toBe(1)
  })

  it('kind가 없는 장소는 관광지로 본다', () => {
    expect(outdoorStopCount([stop('1', 'a')], { a: place('a', false) })).toBe(1)
  })

  it('식당만 있는 비 오는 날은 야외 장소 안내를 내지 않는다', () => {
    const w = weather([{ day: 1, date: '2026-11-04', status: 'ok', forecast: forecast() }])
    const view = weatherSlotView({ weather: w, day: 1, stops: [stop('1', 'r')], places: { r: placeOfKind('r', false, 'restaurant') } })
    if (view.kind !== 'forecast') throw new Error('forecast')
    expect(view.preps.flatMap(c => c.tips).join('\n')).not.toContain('야외 장소')
  })
})

describe('weatherSlotView', () => {
  const base = { stops: [stop('1', 'a')], places: { a: place('a', false) } }

  it('여행 날짜가 없으면 날짜를 정하라고 한다', () => {
    expect(weatherSlotView({ weather: weather([]), day: 1, ...base })).toEqual({ kind: 'no_date' })
  })

  it('지난 날·기간 밖의 날은 그리지 않는다', () => {
    const w = weather([{ day: 1, date: '2026-11-01', status: 'past', forecast: null }])
    expect(weatherSlotView({ weather: w, day: 1, ...base }).kind).toBe('hidden')
    expect(weatherSlotView({ weather: w, day: 2, ...base }).kind).toBe('hidden')
  })

  it('먼 날과 못 받은 날은 안내 글', () => {
    const w = weather([
      { day: 1, date: '2026-11-20', status: 'too_far', forecast: null },
      { day: 2, date: '2026-11-21', status: 'unavailable', forecast: null },
    ])
    expect(weatherSlotView({ weather: w, day: 1, ...base })).toEqual({ kind: 'message', text: '날씨 예보는 여행 10일 전부터 나와요. 가까워지면 다시 확인해 주세요.' })
    expect(weatherSlotView({ weather: w, day: 2, ...base })).toMatchObject({ kind: 'message', text: expect.stringContaining('불러오지 못했어요') })
  })

  it('예보가 있으면 요약·준비 안내·출처 줄', () => {
    const view = weatherSlotView({ weather: weather([{ day: 1, date: '2026-11-04', status: 'ok', forecast: forecast() }]), day: 1, ...base })
    expect(view).toMatchObject({
      kind: 'forecast',
      summary: '흐림, 비 · 최고 15℃ · 최저 9℃ · 비 올 확률 70%',
      warnings: [],
      sourceLine: '출처: 기상청 단기예보 · 11월 3일 5시 발표 · 대전 기준 · 예보는 바뀔 수 있어요',
    })
    if (view.kind !== 'forecast') throw new Error('forecast')
    expect(view.preps.map(c => c.kind)).toEqual(['rain'])
    expect(view.preps[0].tips).toContain('이날 일정에 야외 장소가 1곳 있어요. 실내 장소로 바꿀지 가족과 이야기해 보세요.')
  })

  it('폭염은 경고 쪽으로 나눈다', () => {
    const hot = forecast({ sky: 'clear', precip: 'none', feelsMaxC: 34, tempMaxC: 33, source: 'short' })
    const view = weatherSlotView({ weather: weather([{ day: 1, date: '2026-08-05', status: 'ok', forecast: hot }]), day: 1, ...base })
    if (view.kind !== 'forecast') throw new Error('forecast')
    expect(view.warnings.map(c => c.kind)).toEqual(['heat'])
    expect(view.preps).toEqual([])
  })
})

describe('weatherSlotView: 기상청 특보', () => {
  const base = { stops: [stop('1', 'a')], places: { a: place('a', false) } }
  const coldAlert = { kind: '한파' as const, grade: 'advisory' as const, when: null, issuedAt: '2026-11-03T09:00+09:00' }

  it('특보는 경고 쪽에 오고, 출처 줄에 특보 발표 시각을 더한다', () => {
    const view = weatherSlotView({
      weather: weather([{ day: 1, date: '2026-11-03', status: 'ok', forecast: forecast({ precip: 'none', tempMinC: -13 }), alerts: [coldAlert] }]),
      day: 1,
      ...base,
    })
    if (view.kind !== 'forecast') throw new Error('forecast')
    expect(view.warnings.map(c => c.title)).toEqual(['기상청 한파주의보 발효 중 — 대전'])
    expect(view.sourceLine).toBe('출처: 기상청 단기예보 · 11월 3일 5시 발표 / 기상청 기상특보 · 11월 3일 9시 발표 · 대전 기준 · 예보는 바뀔 수 있어요')
  })

  it('예보를 못 받은 날도 특보는 보여 준다', () => {
    const view = weatherSlotView({ weather: weather([{ day: 1, date: '2026-11-03', status: 'unavailable', forecast: null, alerts: [coldAlert] }]), day: 1, ...base })
    expect(view).toMatchObject({ kind: 'forecast', summary: expect.stringContaining('불러오지 못했어요') })
  })
})
