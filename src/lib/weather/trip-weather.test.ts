import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodedServiceKey } from './kma'
import { KMA_KEY_ERROR_XML, KMA_NO_DATA, MID_LAND_0600, MID_TA_0600, kmaJson, range, shortDayItems } from './test-fixtures'
import { clearWeatherCache, tripWeather, type WeatherDeps } from './trip-weather'

const KEY = 'test-key/abc+def=='
// 2026-11-03 10:00 (KST) — 단기예보 08시 발표, 중기예보 06시 발표를 쓴다
const NOW = new Date('2026-11-03T10:00:00+09:00')

const shortBody = () =>
  kmaJson([
    ...shortDayItems({ baseDate: '20261103', baseTime: '0800', fcstDate: '20261103', hours: range(9, 23), tmx: '16.0' }),
    ...shortDayItems({
      baseDate: '20261103',
      baseTime: '0800',
      fcstDate: '20261104',
      hours: range(0, 23),
      tmx: '14.0',
      tmn: '5.0',
      values: hour => (hour >= 12 && hour <= 15 ? { PTY: '1', POP: '80', PCP: '6.2mm', SKY: '4' } : {}),
    }),
    ...shortDayItems({ baseDate: '20261103', baseTime: '0800', fcstDate: '20261105', hours: range(0, 23), tmx: '12.0', tmn: '1.0' }),
    ...shortDayItems({ baseDate: '20261103', baseTime: '0800', fcstDate: '20261106', hours: [0, 3, 6, 9, 12, 15, 18, 21] }),
  ])

type Route = (url: URL) => { status?: number; body: unknown }

function fakeFetch(route: Route) {
  return vi.fn<WeatherDeps['fetch']>(async url => {
    const { status = 200, body } = route(new URL(url))
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  })
}

// 특보현황: 지금 대전에 한파주의보, 11/4 아침 대설 예비특보 (기상특보 가이드 예제 모양)
const alertBody = () =>
  kmaJson([
    { tmFc: '202611030900', tmSeq: 3, tmEf: '202611031000', t6: 'o 한파주의보 : 대전, 세종  o 풍랑주의보 : 서해중부먼바다', t7: '(1) 대설 예비특보 o 11월 04일 아침 : 대전, 충청남도', other: 'o 없음' },
    { tmFc: '202611020900', tmSeq: 2, tmEf: '202611021000', t6: 'o 폭염경보 : 대전', t7: 'o 없음', other: 'o 없음' },
  ])

const okRoute: Route = url => {
  if (url.pathname.endsWith('/getPwnStatus')) return { body: alertBody() }
  if (url.pathname.endsWith('/getVilageFcst')) return { body: shortBody() }
  if (url.pathname.endsWith('/getMidLandFcst')) return { body: kmaJson([MID_LAND_0600]) }
  if (url.pathname.endsWith('/getMidTa')) return { body: kmaJson([MID_TA_0600]) }
  return { status: 404, body: '' }
}

const depsWith = (fetchFn: WeatherDeps['fetch']): WeatherDeps => ({ fetch: fetchFn, now: () => NOW, serviceKey: KEY })

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  clearWeatherCache()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('tripWeather', () => {
  it('여행 날짜가 없으면 기상청을 부르지 않는다', async () => {
    const fetchFn = fakeFetch(okRoute)
    expect((await tripWeather({ date: null }, depsWith(fetchFn))).days).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('가까운 날은 단기예보, 4~10일 뒤는 중기예보, 더 멀면 too_far', async () => {
    const fetchFn = fakeFetch(okRoute)
    const res = await tripWeather({ date: '2026-11-04', endDate: '2026-11-15' }, depsWith(fetchFn))
    const byDay = new Map(res.days.map(d => [d.date, d]))
    expect(byDay.get('2026-11-04')).toMatchObject({ day: 1, status: 'ok', forecast: { source: 'short', precip: 'rain', popMaxPct: 80, tempMaxC: 14 } })
    expect(byDay.get('2026-11-06')?.forecast?.source).toBe('short')
    expect(byDay.get('2026-11-07')).toMatchObject({ status: 'ok', forecast: { source: 'mid', precip: 'rain', tempMaxC: 14 } })
    expect(byDay.get('2026-11-13')).toMatchObject({ day: 10, status: 'ok', forecast: { source: 'mid' } })
    expect(byDay.get('2026-11-14')).toMatchObject({ status: 'too_far', forecast: null })
    expect(byDay.get('2026-11-15')).toMatchObject({ status: 'too_far', forecast: null })
    expect(res.checkedAt).toBe(NOW.toISOString())
  })

  it('대전 격자·구역과 가장 최근 발표 시각으로 묻는다', async () => {
    const fetchFn = fakeFetch(okRoute)
    await tripWeather({ date: '2026-11-04', endDate: '2026-11-08' }, depsWith(fetchFn))
    const urls = fetchFn.mock.calls.map(([url]) => new URL(url))
    const short = urls.find(url => url.pathname.endsWith('/getVilageFcst'))
    expect(Object.fromEntries(short?.searchParams ?? [])).toMatchObject({ base_date: '20261103', base_time: '0800', nx: '67', ny: '100', dataType: 'JSON' })
    const land = urls.find(url => url.pathname.endsWith('/getMidLandFcst'))
    expect(Object.fromEntries(land?.searchParams ?? [])).toMatchObject({ regId: '11C20000', tmFc: '202611030600' })
    const ta = urls.find(url => url.pathname.endsWith('/getMidTa'))
    expect(ta?.searchParams.get('regId')).toBe('11C20401')
  })

  it('지난 날은 past, 키가 없으면 기상청을 부르지 않고 unavailable', async () => {
    const fetchFn = fakeFetch(okRoute)
    const res = await tripWeather({ date: '2026-11-02', endDate: '2026-11-04' }, { ...depsWith(fetchFn), serviceKey: undefined })
    expect(res.days.map(d => d.status)).toEqual(['past', 'unavailable', 'unavailable'])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('같은 발표는 다시 받지 않는다', async () => {
    const fetchFn = fakeFetch(okRoute)
    await tripWeather({ date: '2026-11-04' }, depsWith(fetchFn))
    await tripWeather({ date: '2026-11-05' }, depsWith(fetchFn))
    const paths = fetchFn.mock.calls.map(([url]) => new URL(url).pathname.split('/').at(-1))
    expect(paths.sort()).toEqual(['getPwnStatus', 'getVilageFcst'])
  })

  it('발효 중인 특보는 오늘에만, 예비특보는 그 날짜에 붙고, 가장 최근 특보현황을 쓴다', async () => {
    const fetchFn = fakeFetch(okRoute)
    const res = await tripWeather({ date: '2026-11-03', endDate: '2026-11-05' }, depsWith(fetchFn))
    const issuedAt = '2026-11-03T09:00+09:00'
    expect(res.days[0].alerts).toEqual([{ kind: '한파', grade: 'advisory', when: null, issuedAt }])
    expect(res.days[1].alerts).toEqual([{ kind: '대설', grade: 'preliminary', when: '아침', issuedAt }])
    expect(res.days[2]).not.toHaveProperty('alerts')
  })

  it('특보를 못 받아도 예보는 그대로 온다', async () => {
    const fetchFn = fakeFetch(url => (url.pathname.endsWith('/getPwnStatus') ? { body: KMA_KEY_ERROR_XML } : okRoute(url)))
    const res = await tripWeather({ date: '2026-11-04' }, depsWith(fetchFn))
    expect(res.days[0]).toMatchObject({ status: 'ok' })
    expect(res.days[0]).not.toHaveProperty('alerts')
    expect(warn).toHaveBeenCalledWith('[weather] 기상청 예보를 못 받았어요', { kind: 'alerts', code: 'service' })
  })

  it('먼 날만 있는 여행은 특보를 묻지 않는다', async () => {
    const fetchFn = fakeFetch(okRoute)
    await tripWeather({ date: '2026-11-10' }, depsWith(fetchFn))
    expect(fetchFn.mock.calls.some(([url]) => url.includes('getPwnStatus'))).toBe(false)
  })

  it('키 오류(XML)면 그날만 unavailable이고, 로그에 키·주소를 남기지 않는다', async () => {
    const fetchFn = fakeFetch(() => ({ body: KMA_KEY_ERROR_XML }))
    const res = await tripWeather({ date: '2026-11-04' }, depsWith(fetchFn))
    expect(res.days).toEqual([{ day: 1, date: '2026-11-04', status: 'unavailable', forecast: null }])
    expect(warn).toHaveBeenCalledWith('[weather] 기상청 예보를 못 받았어요', { kind: 'short', code: 'service' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test-key')
  })

  it('기상청이 500이어도 던지지 않는다', async () => {
    const fetchFn = fakeFetch(() => ({ status: 500, body: '' }))
    const res = await tripWeather({ date: '2026-11-08' }, depsWith(fetchFn))
    expect(res.days[0].status).toBe('unavailable')
  })

  it('가장 최근 중기예보가 아직 없으면(NO_DATA) 그 앞 발표를 쓴다', async () => {
    const fetchFn = fakeFetch(url => {
      const tmFc = url.searchParams.get('tmFc')
      if (tmFc === '202611030600') return { body: KMA_NO_DATA }
      if (url.pathname.endsWith('/getMidLandFcst')) return { body: kmaJson([MID_LAND_0600]) }
      return { body: kmaJson([MID_TA_0600]) }
    })
    const res = await tripWeather({ date: '2026-11-10' }, depsWith(fetchFn))
    // 앞 발표(11/2 18시)의 "8일 뒤"가 11/10이다
    expect(res.days[0]).toMatchObject({ status: 'ok', forecast: { source: 'mid', issuedAt: '2026-11-02T18:00+09:00' } })
  })

  it('단기예보가 1,000줄을 넘으면 다음 쪽도 받는다', async () => {
    const all = shortBody().response.body.items.item
    const fetchFn = fakeFetch(url => {
      if (url.pathname.endsWith('/getPwnStatus')) return { body: alertBody() }
      const page = Number(url.searchParams.get('pageNo'))
      const half = Math.ceil(all.length / 2)
      return { body: kmaJson(page === 1 ? all.slice(0, half) : all.slice(half), all.length) }
    })
    const res = await tripWeather({ date: '2026-11-05' }, depsWith(fetchFn))
    expect(fetchFn.mock.calls.filter(([url]) => url.includes('getVilageFcst'))).toHaveLength(2)
    expect(res.days[0]).toMatchObject({ status: 'ok', forecast: { tempMaxC: 12, tempMinC: 1 } })
  })
})

describe('encodedServiceKey', () => {
  it('디코딩 키는 한 번 인코딩하고, 인코딩 키는 또 인코딩하지 않는다', () => {
    expect(encodedServiceKey('abc+def/==')).toBe('abc%2Bdef%2F%3D%3D')
    expect(encodedServiceKey('abc%2Bdef%2F%3D%3D')).toBe('abc%2Bdef%2F%3D%3D')
  })
})
