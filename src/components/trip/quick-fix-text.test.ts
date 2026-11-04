import { describe, expect, it } from 'vitest'
import { quickFixEmptyNotice, quickFixStatus } from './quick-fix-text'

describe('quickFixStatus', () => {
  it('조건을 넘는 곳이 없고 정보도 충분하면 조건 충족으로 말한다', () => {
    expect(quickFixStatus({ enough: true, verdict: 'ok' })).toEqual({
      tone: 'ok',
      text: '✓ 이렇게 하면 조건에 맞아요',
    })
  })

  it('조건을 넘는 곳은 없지만 원래 정보가 없는 곳이 남으면 조건에 맞는다고 말하지 않는다', () => {
    const status = quickFixStatus({ enough: true, verdict: 'info' })
    expect(status.text).toBe('? 조건을 넘는 곳은 없어요 · 정보가 없는 곳은 확인이 필요해요')
    expect(status.text).not.toContain('이렇게 하면 조건에 맞아요')
    expect(status.tone).toBe('info')
  })

  it('조건을 넘는 곳이 남으면 그대로 경고한다', () => {
    expect(quickFixStatus({ enough: false, verdict: 'adjust' })).toEqual({
      tone: 'warn',
      text: '! 그래도 조건을 넘는 곳이 남아요',
    })
    expect(quickFixStatus({ enough: false, verdict: 'info' })).toEqual({
      tone: 'warn',
      text: '! 그래도 조건을 넘는 곳이 남아요',
    })
  })
})

describe('quickFixEmptyNotice', () => {
  it('기준 판정이 조건 충족이면 고칠 곳이 없다고 말한다', () => {
    expect(quickFixEmptyNotice('ok')).toEqual({
      tone: 'ok',
      text: '고칠 곳이 없어요. 이 일정은 지금 조건에 맞아요.',
    })
  })

  it('정보가 없는 곳이 있으면 조건에 맞다고 말하지 않는다', () => {
    const notice = quickFixEmptyNotice('info')
    expect(notice).toEqual({
      tone: 'info',
      text: '조건을 넘는 곳은 없어요. 정보가 없는 곳은 확인이 필요해요.',
    })
    expect(notice.text).not.toContain('조건에 맞아요')
  })

  it('조건을 넘는데 고칠 안을 못 찾으면 조건에 맞다고 말하지 않는다', () => {
    const notice = quickFixEmptyNotice('adjust')
    expect(notice.tone).toBe('warn')
    expect(notice.text).not.toContain('조건에 맞아요')
  })
})
