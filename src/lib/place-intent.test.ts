import { beforeEach, describe, expect, it } from 'vitest'
import { PLACE_INTENT_KEY, clearPlaceIntent, peekPlaceIntent, rememberPlaceIntent, scheduleLineForPlace } from './place-intent'

// vitest 기본 환경(node)에는 sessionStorage 가 없어서 같은 모양의 가짜를 단다
class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

describe('고른 장소 기억', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage()
  })

  it('붙여넣기 칸에 들어갈 한 줄은 10:00 + 장소 이름', () => {
    expect(scheduleLineForPlace('엑스포다리')).toBe('10:00 엑스포다리')
  })

  it('기억한 장소는 읽어도 남아 있고, 지우면 사라진다', () => {
    rememberPlaceIntent('기초과학연구원 도서관')
    expect(peekPlaceIntent()).toBe('기초과학연구원 도서관')
    expect(peekPlaceIntent()).toBe('기초과학연구원 도서관')
    clearPlaceIntent()
    expect(peekPlaceIntent()).toBeNull()
  })

  it('기억한 게 없거나 빈 값이면 null', () => {
    expect(peekPlaceIntent()).toBeNull()
    sessionStorage.setItem(PLACE_INTENT_KEY, '   ')
    expect(peekPlaceIntent()).toBeNull()
  })

  it('저장소를 못 쓰면 조용히 넘어간다', () => {
    ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    expect(() => rememberPlaceIntent('a')).not.toThrow()
    expect(peekPlaceIntent()).toBeNull()
    expect(() => clearPlaceIntent()).not.toThrow()
  })
})
