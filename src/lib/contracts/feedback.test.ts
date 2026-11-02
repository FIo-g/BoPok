import { describe, expect, it } from 'vitest'
import { DayFeedbackInputSchema, DayFeedbackSchema } from './index'

const base = {
  tripId: 'trip1',
  day: 1,
  userId: 'u-son',
  score: 4,
  createdAt: '2026-11-02T09:00:00.000Z',
}

describe('일차별 만족도', () => {
  it('1~5점만 받는다', () => {
    expect(DayFeedbackSchema.safeParse({ ...base, score: 1 }).success).toBe(true)
    expect(DayFeedbackSchema.safeParse({ ...base, score: 5 }).success).toBe(true)
    expect(DayFeedbackSchema.safeParse({ ...base, score: 0 }).success).toBe(false)
    expect(DayFeedbackSchema.safeParse({ ...base, score: 6 }).success).toBe(false)
    expect(DayFeedbackSchema.safeParse({ ...base, score: 3.5 }).success).toBe(false)
  })

  it('일차는 1 이상의 정수', () => {
    expect(DayFeedbackSchema.safeParse({ ...base, day: 0 }).success).toBe(false)
    expect(DayFeedbackSchema.safeParse({ ...base, day: 1.5 }).success).toBe(false)
    expect(DayFeedbackSchema.safeParse({ ...base, day: 2 }).success).toBe(true)
  })

  it('한 줄은 의견과 같은 100자까지, 앞뒤 공백은 잘린다', () => {
    expect(DayFeedbackSchema.safeParse({ ...base, comment: 'a'.repeat(100) }).success).toBe(true)
    expect(DayFeedbackSchema.safeParse({ ...base, comment: 'a'.repeat(101) }).success).toBe(false)
    expect(DayFeedbackSchema.parse({ ...base, comment: '  좋았어요  ' }).comment).toBe('좋았어요')
  })

  it('한 줄은 없어도 된다', () => {
    expect(DayFeedbackSchema.safeParse(base).success).toBe(true)
  })

  it('DB에 NULL로 저장된 한 줄(null)도 읽는다 (의견의 comment와 같다)', () => {
    const parsed = DayFeedbackSchema.safeParse({ ...base, comment: null })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.comment).toBeNull()
    expect(DayFeedbackInputSchema.safeParse({ day: 1, score: 4, comment: null }).success).toBe(true)
  })

  it('요청 본문은 일차·점수·한 줄만 받는다', () => {
    const input = DayFeedbackInputSchema.parse({ day: 1, score: 5, comment: '걷기 편했어요' })
    expect(input).toEqual({ day: 1, score: 5, comment: '걷기 편했어요' })
    expect(DayFeedbackInputSchema.safeParse({ day: 1, score: 6 }).success).toBe(false)
    expect(DayFeedbackInputSchema.safeParse({ day: 0, score: 3 }).success).toBe(false)
    expect(DayFeedbackInputSchema.safeParse({ score: 3 }).success).toBe(false)
  })
})
