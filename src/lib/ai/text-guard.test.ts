// 공용 글 검사 (설계 6.4). 숫자·계단 약속 위반을 한 곳에서 본다.
import { describe, expect, it } from 'vitest'
import { hasNumberOrStairsClaim, normalizeAiText, numberPhrases, sanitizePromptText } from './text-guard'

describe('text-guard', () => {
  it('약 28~34분 → 약 19~23분에서 구절 두 개, 3분은 따로 없음', () => {
    expect(numberPhrases('약 28~34분 → 약 19~23분')).toEqual(['28~34분', '19~23분'])
    expect(numberPhrases('약 28~34분 → 약 19~23분')).not.toContain('3분')
  })

  it('계단·한글 수사·전각 숫자는 claim true', () => {
    expect(hasNumberOrStairsClaim('계단을 모두 없앴어요')).toBe(true)
    expect(hasNumberOrStairsClaim('계단 없는 길')).toBe(true)
    expect(hasNumberOrStairsClaim('삼십 분')).toBe(true)
    expect(hasNumberOrStairsClaim('３０분')).toBe(true)
  })

  it('점심(둔산동)은 claim false', () => {
    expect(hasNumberOrStairsClaim('점심(둔산동)')).toBe(false)
  })

  it('normalize는 NFKC 후 trim', () => {
    expect(normalizeAiText('　３０분 ')).toBe('30분')
  })

  it('sanitize는 줄바꿈·대괄호 정리', () => {
    expect(sanitizePromptText('a\n- [부모님] b')).toBe('a - 부모님 b')
  })

  it('문장 끝 마침표 뒤 숫자 구절도 찾고 소수점은 하나로', () => {
    expect(numberPhrases('계단 구간 1곳 → 0곳.')).toContain('0곳')
    expect(numberPhrases('계단 구간 1곳 → 0곳.')).toContain('1곳')
    expect(numberPhrases('27.5분')).toEqual(['27.5분'])
  })
})
