// 기상청 기상특보 조회서비스의 특보현황(getPwnStatus) 글 → 대전에 걸린 특보·예비특보.
// t6(특보발효현황)은 "o 폭염경보 : 대전, 세종, …"처럼, t7(예비특보 발효현황)은 "(1) 한파 예비특보 o 11월 14일 아침 : 대전, …"처럼 온다
// (기상특보 조회서비스 오픈API 활용가이드 2026-06-01판 예제). 대전의 특보구역 이름은 "대전"(구역코드 L1030100)이다.
// 글 모양이 예제와 다르면 아무 특보도 꺼내지 않는다 — 없는 특보를 지어내지 않는 쪽으로 실패한다.
import 'server-only'
import { WEATHER_ALERT_KINDS, type WeatherAlert, type WeatherAlertGrade, type WeatherAlertKind } from '@/lib/contracts'
import { addDays, dashed, issuedAtOf } from './time'

export type ParsedAlerts = {
  active: WeatherAlert[] // 지금 대전에 발효 중인 특보
  preliminary: { date: string; alert: WeatherAlert }[] // 대전에 걸린 예비특보와 그 날짜 'YYYY-MM-DD'
}

export const NO_ALERTS: ParsedAlerts = { active: [], preliminary: [] }

// 지역 목록에 "대전"이 낱말로 있는지 ("대전광역시"도 받는다)
const DAEJEON_RE = /(^|[^가-힣])대전(광역시)?(?![가-힣])/
const GRADE: Record<string, WeatherAlertGrade> = { 주의보: 'advisory', 경보: 'warning', 중대경보: 'severe' }

const isLandKind = (kind: string): kind is WeatherAlertKind => (WEATHER_ALERT_KINDS as readonly string[]).includes(kind)

// "o " 로 시작하는 줄들로 나눈다 (줄바꿈이 있어도, 한 줄에 이어 붙어 있어도)
function bullets(text: string): string[] {
  return text
    .split(/(?:^|\s)o\s+/)
    .map(part => part.trim())
    .filter(part => part !== '')
}

function dedupe(alerts: WeatherAlert[]): WeatherAlert[] {
  const seen = new Set<string>()
  return alerts.filter(alert => {
    const key = `${alert.kind}:${alert.grade}:${alert.when ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// t6: 지금 발효 중인 특보
export function parseActiveAlerts(t6: string, issuedAt: string): WeatherAlert[] {
  const out: WeatherAlert[] = []
  for (const line of bullets(t6)) {
    const m = line.match(/^(.+?)(중대경보|경보|주의보)\s*:\s*([\s\S]+)$/)
    if (!m) continue
    const kind = m[1].trim()
    if (!isLandKind(kind) || !DAEJEON_RE.test(m[3])) continue
    out.push({ kind, grade: GRADE[m[2]], when: null, issuedAt })
  }
  return dedupe(out)
}

// t7: 예비특보. 날짜에는 해가 없어서 발표일 기준으로 붙인다 (12월에 낸 1월 예비특보는 다음 해)
export function parsePreliminaryAlerts(t7: string, issuedDate: string, issuedAt: string): ParsedAlerts['preliminary'] {
  const out: ParsedAlerts['preliminary'] = []
  for (const section of t7.split(/\(\d+\)\s*/)) {
    const head = section.match(/^\s*(\S+?)\s*예비특보/)
    if (!head) continue
    const kind = head[1]
    if (!isLandKind(kind)) continue
    for (const line of bullets(section.slice(head[0].length))) {
      const m = line.match(/^(\d{1,2})월\s*(\d{1,2})일\s*([^:]*?)\s*:\s*([\s\S]+)$/)
      if (!m || !DAEJEON_RE.test(m[4])) continue
      const year = Number(issuedDate.slice(0, 4))
      let date = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
      if (date < addDays(issuedDate, -1)) date = `${year + 1}${date.slice(4)}`
      const when = m[3].trim()
      out.push({ date, alert: { kind, grade: 'preliminary', when: when === '' ? null : when.slice(0, 20), issuedAt } })
    }
  }
  const seen = new Set<string>()
  return out.filter(({ date, alert }) => {
    const key = `${date}:${alert.kind}:${alert.when ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// 특보현황 한 건(가장 최근 발표) → 대전 특보. tmFc는 'YYYYMMDDHHMM'
export function parsePwnStatus(item: { tmFc?: unknown; t6?: unknown; t7?: unknown }): ParsedAlerts {
  const tmFc = String(item.tmFc ?? '').trim()
  if (!/^\d{12}$/.test(tmFc)) return NO_ALERTS
  const issuedAt = issuedAtOf(tmFc.slice(0, 8), tmFc.slice(8, 12))
  const issuedDate = dashed(tmFc.slice(0, 8))
  return {
    active: typeof item.t6 === 'string' ? parseActiveAlerts(item.t6, issuedAt) : [],
    preliminary: typeof item.t7 === 'string' ? parsePreliminaryAlerts(item.t7, issuedDate, issuedAt) : [],
  }
}
