// 팀 요청: 기존 공공데이터포털 키로 두 날씨 서비스의 실제 이용권한만 확인한다.
// 키·요청 URL·예보 원문은 출력하거나 저장하지 않는다. 호출은 서비스별 1회다.
import { mkdir, writeFile } from 'node:fs/promises'
const rawKey = process.env.TOURAPI_SERVICE_KEY?.trim()
if (!rawKey) throw Error('TOURAPI_SERVICE_KEY 설정이 필요합니다. 값은 출력하지 않았습니다.')
const key = rawKey.includes('%') ? decodeURIComponent(rawKey) : rawKey
const now = new Date()
const kst = new Date(now.getTime() + 9 * 3600000 - 3600000)
function latest(hours) {
  const date = new Date(kst)
  let hour = hours.findLast(hour => hour <= date.getUTCHours())
  if (hour === undefined) { date.setUTCDate(date.getUTCDate() - 1); hour = hours.at(-1) }
  return { date: date.toISOString().slice(0, 10).replaceAll('-', ''), time: `${String(hour).padStart(2, '0')}00` }
}
const short = latest([2, 5, 8, 11, 14, 17, 20, 23])
const mid = latest([6, 18])
const services = [
  { name: '단기예보', path: 'VilageFcstInfoService_2.0/getVilageFcst', params: { base_date: short.date, base_time: short.time, nx: '67', ny: '100' } },
  { name: '중기예보', path: 'MidFcstInfoService/getMidFcst', params: { tmFc: mid.date + mid.time, stnId: '108' } },
]
const result = { checkedAt: now.toISOString(), purpose: '서비스 이용권한 확인: 단기는 검증 격자, 중기는 전국 전망', services: [] }
for (const service of services) {
  const url = new URL(`https://apis.data.go.kr/1360000/${service.path}`)
  url.search = new URLSearchParams({ serviceKey: key, dataType: 'JSON', pageNo: '1', numOfRows: '1', ...service.params }).toString()
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { /* 인증 실패는 XML일 수도 있다. */ }
    const code = body?.response?.header?.resultCode ?? text.match(/<(?:returnReasonCode|resultCode)>([^<]+)</)?.[1]
    result.services.push({ name: service.name, httpStatus: response.status,
      resultCode: typeof code === 'string' && /^[A-Z0-9_]{1,50}$/.test(code) ? code : null,
      accessible: response.ok && code === '00',
      itemsReceived: Array.isArray(body?.response?.body?.items?.item) ? body.response.body.items.item.length : 0 })
  } catch {
    result.services.push({ name: service.name, accessible: false, networkError: true })
  }
}
await mkdir('data/services', { recursive: true })
await writeFile('data/services/weather-access-check.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
