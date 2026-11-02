import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/lib/contracts'
import { chatCursor, chatTime, mergeMessages } from './chat-state'

const message = (id: string, createdAt: string): ChatMessage => ({ id, tripId: 't', userId: 'u', userName: '엄마', text: '안녕', createdAt })

describe('mergeMessages', () => {
  const first = message('a', '2026-11-03T01:00:00.000Z')
  const second = message('b', '2026-11-03T01:00:10.000Z')

  it('새 글을 뒤에 붙인다', () => {
    expect(mergeMessages([first], [second]).map(one => one.id)).toEqual(['a', 'b'])
  })

  it('이미 있는 글은 다시 넣지 않는다', () => {
    expect(mergeMessages([first, second], [second, first]).map(one => one.id)).toEqual(['a', 'b'])
  })

  it('새 글이 없으면 같은 배열을 돌려준다', () => {
    const current = [first]
    expect(mergeMessages(current, [first])).toBe(current)
  })

  it('늦게 도착한 앞선 글도 시각 순서로 놓는다', () => {
    expect(mergeMessages([second], [first]).map(one => one.id)).toEqual(['a', 'b'])
  })
})

describe('chatCursor', () => {
  it('마지막 글의 시각이고, 글이 없으면 undefined', () => {
    expect(chatCursor([])).toBeUndefined()
    expect(chatCursor([message('a', '2026-11-03T01:00:00.000Z')])).toBe('2026-11-03T01:00:00.000Z')
  })
})

describe('chatTime', () => {
  it('시:분으로 쓴다', () => {
    expect(chatTime(new Date(2026, 10, 3, 9, 5).toISOString())).toBe('09:05')
  })
})
