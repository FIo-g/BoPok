// 실제 연결 확인용 수동 명령이다. vitest에서는 외부 기상청을 부르지 않는다.
// 앱의 조회·계약 검사·화면 변환을 그대로 사용하며 DB와 키 값은 저장하지 않는다.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
createRequire(require.resolve('drizzle-kit'))('tsx/cjs/api').register()
const { tripWeather, clearWeatherCache } = require('../../src/lib/weather/trip-weather.ts')
const { kstToday, addDays } = require('../../src/lib/weather/time.ts')
const { TripWeatherResponseSchema } = require('../../src/lib/contracts/weather.ts')
const { weatherSlotView } = require('../../src/lib/plan/weather-view.ts')

async function main() {
  const serviceKey = process.env.TOURAPI_SERVICE_KEY?.trim()
  if (!serviceKey) throw Error('키 설정 필요')
  const now = new Date()
  const today = kstToday(now)
  const requests = []
  const fetchChecked = async (url, init) => {
    const address = new URL(url)
    if (address.hostname !== 'apis.data.go.kr' || requests.length >= 10) throw Error('호출 범위 초과')
    const entry = { operation: address.pathname.split('/').at(-1), httpStatus: null, resultCode: null, items: 0 }
    requests.push(entry)
    const response = await fetch(url, { ...init, redirect: 'error' })
    entry.httpStatus = response.status
    try {
      const body = await response.clone().json()
      const code = body?.response?.header?.resultCode
      entry.resultCode = typeof code === 'string' && /^\d{1,3}$/.test(code) ? code : null
      const items = body?.response?.body?.items?.item
      entry.items = Array.isArray(items) ? items.length : items && typeof items === 'object' ? 1 : 0
    } catch { /* 앱에서 원래 응답을 검사한다. 원문·요청 주소는 출력하지 않는다. */ }
    return response
  }
  clearWeatherCache()
  const weather = TripWeatherResponseSchema.parse(await tripWeather({ date: today, endDate: addDays(today, 10) }, {
    serviceKey, now: () => now, fetch: fetchChecked,
  }))
  const days = weather.days.map(day => {
    const view = weatherSlotView({ weather, day: day.day, stops: [], places: {} })
    return { day: day.day, date: day.date, status: day.status, source: day.forecast?.source ?? null,
      view: view.kind, summary: view.kind === 'forecast' ? view.summary : null,
      sourceLine: view.kind === 'forecast' ? view.sourceLine : null,
      alerts: day.alerts ?? [] }
  })
  const operations = new Set(requests.filter(item => item.httpStatus === 200 && item.resultCode === '00').map(item => item.operation))
  const shortWithinPublishedWindow = weather.days.every(day => {
    if (day.forecast?.source !== 'short') return true
    const issued = day.forecast.issuedAt
    return day.date <= addDays(issued.slice(0, 10), Number(issued.slice(11, 13)) <= 14 ? 3 : 4)
  })
  const passed = ['getVilageFcst', 'getMidLandFcst', 'getMidTa', 'getPwnStatus'].every(item => operations.has(item))
    && days.some(day => day.status === 'ok' && day.source === 'short' && day.view === 'forecast')
    && days.some(day => day.status === 'ok' && day.source === 'mid' && day.view === 'forecast')
    && days.every(day => day.status !== 'unavailable') && shortWithinPublishedWindow
  const report = { checkedAt: now.toISOString(), passed, sharedDbWritten: false, externalRequests: requests.length,
    requests, shortWithinPublishedWindow, days, note: '기상특보 API 응답·대전 파싱 경로를 확인했다. 현재 특보가 없으면 경고 표시를 인위적으로 만들지 않는다.' }
  await mkdir('data/services', { recursive: true })
  await writeFile('data/services/weather-integration-check.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (!passed) process.exitCode = 1
}
await main().catch(() => {
  console.error('날씨 실제 연결 검사 실패: 키·주소·원문은 출력하지 않았습니다.')
  process.exitCode = 1
})
