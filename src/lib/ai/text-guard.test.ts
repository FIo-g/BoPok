// 공용 글 검사 (설계 6.4). 숫자·계단 약속 위반을 한 곳에서 본다.
import { describe, expect, it } from 'vitest'
import { hasDietTalk, hasHealthClaim, hasNumberOrStairsClaim, mentionsFoodTags, normalizeAiText, numberPhrases, sanitizePromptText } from './text-guard'

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

describe('mentionsFoodTags (보낸 피할 음식을 되풀이했는지)', () => {
  it('보낸 태그의 말이 있으면 true', () => {
    expect(mentionsFoodTags('짠 음식이 적은 곳으로', ['salty'])).toBe(true)
    expect(mentionsFoodTags('덜 단 디저트 카페', ['sugary'])).toBe(true)
    expect(mentionsFoodTags('술 없는 식당', ['alcohol'])).toBe(true)
    expect(mentionsFoodTags('기름진 음식은 뺐어요', ['fatty'])).toBe(true)
  })
  it('보내지 않은 태그는 보지 않는다', () => {
    expect(mentionsFoodTags('짠 음식이 적은 곳으로', ['sugary'])).toBe(false)
    expect(mentionsFoodTags('짠 음식이 적은 곳으로', [])).toBe(false)
  })
  it("'미술관'·'기술'의 술은 술 이야기가 아니다", () => {
    expect(mentionsFoodTags('대전시립미술관을 먼저 넣었어요', ['alcohol'])).toBe(false)
    expect(mentionsFoodTags('과학 기술 체험', ['alcohol'])).toBe(false)
  })
  it('hasDietTalk은 건강 낱말 또는 보낸 태그 이야기', () => {
    expect(hasDietTalk('당뇨가 있으셔서', [])).toBe(true)
    expect(hasDietTalk('짠 음식은 뺐어요', ['salty'])).toBe(true)
    expect(hasDietTalk('쉬는 자리를 넣었어요', ['salty', 'sugary'])).toBe(false)
  })
})

describe('hasHealthClaim', () => {
  it('건강 상태를 짐작하는 낱말이 있으면 true', () => {
    const words = [
      '당뇨', '혈당', '혈압', '고지혈', '콜레스테롤', '신장', '콩팥', '통풍', '요산', '심장',
      '항응고', '와파린', '자몽', '저염', '싱겁', '복용', '지병', '질환', '약을', '약은', '약이',
    ]
    for (const word of words) {
      expect(hasHealthClaim(`${word} 때문에 이렇게 짰어요`)).toBe(true)
    }
    expect(hasHealthClaim('당뇨가 있으셔서 단 음식을 뺐어요')).toBe(true)
    expect(hasHealthClaim('약을 드셔야 해서 점심을 일찍 넣었어요')).toBe(true)
  })

  it('앞뒤 공백·전각 공백이 있어도 본다', () => {
    expect(hasHealthClaim('　혈압　주의')).toBe(true)
  })

  it('일정 이야기는 false — 쉬는 자리, 엔진 범위 문구, 식당 이름', () => {
    expect(hasHealthClaim('쉬는 자리를 넣었어요')).toBe(false)
    expect(hasHealthClaim('약 28~34분에서 약 19~23분으로 줄어요')).toBe(false)
    expect(hasHealthClaim('점심(둔산동)')).toBe(false)
    expect(hasHealthClaim('약속 시간에 맞춰 성심당을 먼저 넣었어요')).toBe(false)
    expect(hasHealthClaim('성심당 예약은 그대로 두었어요')).toBe(false)
    expect(hasHealthClaim('예약이 있는 곳을 먼저 넣었어요')).toBe(false)
    expect(hasHealthClaim('혈압약을 챙기세요')).toBe(true)
    expect(hasHealthClaim('')).toBe(false)
  })
})
