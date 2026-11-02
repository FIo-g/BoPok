import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/lib/contracts'
import { advanceCursor, chatTime, mergeMessages } from './chat-state'

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

describe('advanceCursor', () => {
  it('받은 글의 마지막 시각으로 옮긴다', () => {
    const received = [message('a', '2026-11-03T01:00:00.000Z'), message('b', '2026-11-03T01:00:10.000Z')]
    expect(advanceCursor(undefined, received)).toBe('2026-11-03T01:00:10.000Z')
  })

  it('받은 글이 없으면 그대로 둔다', () => {
    expect(advanceCursor('2026-11-03T01:00:00.000Z', [])).toBe('2026-11-03T01:00:00.000Z')
  })

  it('내가 글을 보내도 커서가 그대로라, 그 사이 다른 가족이 쓴 글을 다음 갱신에서 받는다', () => {
    const lastPolled = message('a', '2026-11-03T01:00:00.000Z')
    const theirs = message('theirs', '2026-11-03T01:00:03.000Z')
    const mine = message('mine', '2026-11-03T01:00:05.000Z')

    // 받은 글로만 옮기므로 내 글(01:00:05)은 커서가 되지 않는다
    const cursor = advanceCursor(undefined, [lastPolled])
    let shown = mergeMessages([lastPolled], [mine])

    const onServer = [lastPolled, theirs, mine]
    const received = onServer.filter(one => one.createdAt >= cursor!)
    shown = mergeMessages(shown, received)

    expect(shown.map(one => one.id)).toEqual(['a', 'theirs', 'mine'])
  })
})

describe('chatTime', () => {
  it('시:분으로 쓴다', () => {
    expect(chatTime(new Date(2026, 10, 3, 9, 5).toISOString())).toBe('09:05')
  })
})
