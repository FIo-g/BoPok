import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, kstToday, midTmFc, shortBase } from './time'

// 한국 시간으로 적은 시각 → Date
const kst = (text: string) => new Date(`${text}+09:00`)

describe('shortBase', () => {
  it('발표 10분 뒤부터 그 발표를 쓴다', () => {
    expect(shortBase(kst('2026-11-03T05:09'))).toEqual({ baseDate: '20261103', baseTime: '0200' })
    expect(shortBase(kst('2026-11-03T05:10'))).toEqual({ baseDate: '20261103', baseTime: '0500' })
    expect(shortBase(kst('2026-11-03T23:30'))).toEqual({ baseDate: '20261103', baseTime: '2300' })
  })

  it('02:10 전이면 어제 23시 발표 (서버 시계가 UTC여도 한국 날짜로 센다)', () => {
    expect(shortBase(kst('2026-11-03T01:00'))).toEqual({ baseDate: '20261102', baseTime: '2300' })
    expect(shortBase(new Date('2026-11-02T16:30:00Z'))).toEqual({ baseDate: '20261102', baseTime: '2300' })
  })
})

describe('midTmFc', () => {
  it('06시·18시 발표를 30분 뒤부터 쓴다', () => {
    expect(midTmFc(kst('2026-11-03T06:29'))).toBe('202611021800')
    expect(midTmFc(kst('2026-11-03T06:30'))).toBe('202611030600')
    expect(midTmFc(kst('2026-11-03T19:00'))).toBe('202611031800')
  })

  it('back=1이면 그 앞 발표', () => {
    expect(midTmFc(kst('2026-11-03T07:00'), 1)).toBe('202611021800')
    expect(midTmFc(kst('2026-11-03T19:00'), 1)).toBe('202611030600')
    expect(midTmFc(kst('2026-11-03T05:00'), 1)).toBe('202611020600')
  })
})

describe('날짜 계산', () => {
  it('오늘은 한국 날짜', () => {
    expect(kstToday(new Date('2026-11-02T15:00:00Z'))).toBe('2026-11-03')
    expect(kstToday(new Date('2026-11-02T14:59:00Z'))).toBe('2026-11-02')
  })

  it('날 수와 더하기', () => {
    expect(daysBetween('2026-11-03', '2026-11-13')).toBe(10)
    expect(daysBetween('2026-11-03', '2026-11-01')).toBe(-2)
    expect(addDays('2026-12-30', 4)).toBe('2027-01-03')
  })
})
