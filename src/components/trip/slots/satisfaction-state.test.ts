import { describe, expect, it } from 'vitest'
import { dayHasArrived, feedbackQuestion, localToday } from './satisfaction-state'

describe('dayHasArrived', () => {
  it('그날 전에는 묻지 않고, 그날부터 묻는다', () => {
    expect(dayHasArrived('2026-11-15', 1, '2026-11-14')).toBe(false)
    expect(dayHasArrived('2026-11-15', 1, '2026-11-15')).toBe(true)
    expect(dayHasArrived('2026-11-15', 1, '2026-12-01')).toBe(true)
  })

  it('둘째 날은 시작일 다음 날부터 묻는다', () => {
    expect(dayHasArrived('2026-11-15', 2, '2026-11-15')).toBe(false)
    expect(dayHasArrived('2026-11-15', 2, '2026-11-16')).toBe(true)
  })

  it('달이 넘어가도 맞다', () => {
    expect(dayHasArrived('2026-11-30', 2, '2026-12-01')).toBe(true)
  })

  it('날짜가 없는 여행은 묻지 않는다', () => {
    expect(dayHasArrived(null, 1, '2026-11-15')).toBe(false)
  })
})

describe('feedbackQuestion', () => {
  it('오늘이면 "오늘", 지난 날이면 일차로 묻는다', () => {
    expect(feedbackQuestion('2026-11-15', 1, '2026-11-15')).toBe('오늘 어떠셨어요?')
    expect(feedbackQuestion('2026-11-15', 1, '2026-11-16')).toBe('1일차는 어떠셨어요?')
  })
})

describe('localToday', () => {
  it('기기 시간대의 날짜를 쓴다', () => {
    expect(localToday(new Date(2026, 10, 3, 0, 30))).toBe('2026-11-03')
  })
})
