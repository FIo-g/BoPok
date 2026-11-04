import { describe, expect, it } from 'vitest'
import { dayHasArrived, feedbackQuestion, localToday, matchesSaved, savedFeedbackKey } from './satisfaction-state'

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

describe('savedFeedbackKey', () => {
  it('점수나 한 줄이 바뀌면 달라진다', () => {
    expect(savedFeedbackKey({ score: 3 })).not.toBe(savedFeedbackKey({ score: 5 }))
    expect(savedFeedbackKey({ score: 3, comment: '좋아요' })).not.toBe(savedFeedbackKey({ score: 3 }))
  })

  it('한 줄이 없을 때 null과 undefined는 같다', () => {
    expect(savedFeedbackKey({ score: 3, comment: null })).toBe(savedFeedbackKey({ score: 3 }))
  })

  it('저장된 값이 없으면 빈 글자다', () => {
    expect(savedFeedbackKey(undefined)).toBe('')
  })
})

describe('matchesSaved', () => {
  it('저장 직후처럼 값이 같으면 true (앞뒤 공백은 무시)', () => {
    expect(matchesSaved({ score: 5, comment: '좋아요' }, 5, ' 좋아요 ')).toBe(true)
    expect(matchesSaved({ score: 5, comment: null }, 5, '')).toBe(true)
  })

  it('다른 화면에서 값이 바뀌면 false', () => {
    expect(matchesSaved({ score: 5, comment: '좋아요' }, 3, '좋아요')).toBe(false)
    expect(matchesSaved({ score: 5, comment: '좋아요' }, 5, '')).toBe(false)
  })

  it('저장된 값이 없고 입력도 없으면 true', () => {
    expect(matchesSaved(undefined, null, '')).toBe(true)
  })
})
