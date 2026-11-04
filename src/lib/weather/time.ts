// 기상청 발표 시각 계산. 기상청 시각은 모두 한국 시간(KST, 서머타임 없음)이다.
// 배포 함수는 싱가포르에서 돌고 서버 시계는 UTC라서, 날짜·시각은 언제나 여기서 KST로 바꿔 계산한다.
import 'server-only'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// 단기예보 발표 시각 (하루 8번). 발표 10분 뒤부터 API로 받을 수 있다 (단기예보 가이드 참고자료 "예보 발표시각")
const SHORT_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const
const SHORT_READY_MIN = 10
// 중기예보 발표 시각 (06시·18시). 받을 수 있게 되는 시각은 가이드에 없어서 30분 기다린다 — 없으면 앞 발표를 쓴다
const MID_BASE_HOURS = [6, 18] as const
const MID_READY_MIN = 30

const pad = (value: number, size = 2): string => String(value).padStart(size, '0')

type KstClock = { year: number; month: number; day: number; minutesOfDay: number }

function kstClock(now: Date): KstClock {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

// KST 기준 n일 전후의 'YYYYMMDD'
function kstYmd(now: Date, addDays = 0): string {
  const { year, month, day } = kstClock(new Date(now.getTime() + addDays * DAY_MS))
  return `${year}${pad(month)}${pad(day)}`
}

// 오늘(KST) 'YYYY-MM-DD'
export function kstToday(now: Date): string {
  return dashed(kstYmd(now))
}

// 'YYYYMMDD' → 'YYYY-MM-DD'
export function dashed(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

// 'YYYY-MM-DD' 두 날짜 사이의 날 수 (to - from)
export function daysBetween(from: string, to: string): number {
  const utc = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)))
  return Math.round((utc(to) - utc(from)) / DAY_MS)
}

// 'YYYY-MM-DD' 에 n일 더하기
export function addDays(ymd: string, days: number): string {
  const utc = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)))
  return new Date(utc + days * DAY_MS).toISOString().slice(0, 10)
}

// 지금 받을 수 있는 가장 최근 단기예보 발표. 오늘 02:10 전이면 어제 23시 발표
export function shortBase(now: Date): { baseDate: string; baseTime: string } {
  const { minutesOfDay } = kstClock(now)
  const ready = SHORT_BASE_HOURS.filter(hour => hour * 60 + SHORT_READY_MIN <= minutesOfDay)
  if (ready.length === 0) return { baseDate: kstYmd(now, -1), baseTime: '2300' }
  return { baseDate: kstYmd(now), baseTime: `${pad(ready[ready.length - 1])}00` }
}

// 중기예보 발표 시각 'YYYYMMDDHHMM'. back=1이면 그 앞 발표 (가장 최근 것이 아직 없을 때 쓴다)
export function midTmFc(now: Date, back = 0): string {
  const { minutesOfDay } = kstClock(now)
  // 오늘 나온 발표들을 최근 것부터 세고, 모자라면 어제·그제로 넘어간다
  const issues: string[] = []
  for (let dayBack = 0; issues.length <= back; dayBack += 1) {
    const ymd = kstYmd(now, -dayBack)
    for (const hour of [...MID_BASE_HOURS].reverse()) {
      if (dayBack === 0 && hour * 60 + MID_READY_MIN > minutesOfDay) continue
      issues.push(`${ymd}${pad(hour)}00`)
    }
  }
  return issues[back]
}

// 발표 시각 문자열 "2026-11-03T05:00+09:00"
export function issuedAtOf(ymd: string, hhmm: string): string {
  return `${dashed(ymd)}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}+09:00`
}
