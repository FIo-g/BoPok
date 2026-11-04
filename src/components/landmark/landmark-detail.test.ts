import { describe, expect, it } from 'vitest'
import {
  CLOSED, detailReducer, isDetailVisible, placeIdFromSearch, searchWithPlace, shouldCloseOnKey, shouldCloseSheet,
  type DetailEvent, type DetailState,
} from './landmark-detail'

const run = (events: DetailEvent[], start: DetailState = CLOSED) => events.reduce(detailReducer, start)

describe('상세 화면 상태 흐름', () => {
  it('모형을 누르면 다가가고(flying) → 도착(opening) → 등장(open) 순서로 간다', () => {
    expect(run([{ type: 'select', id: 'ibs-library' }])).toEqual({ id: 'ibs-library', phase: 'flying' })
    expect(run([{ type: 'select', id: 'ibs-library' }, { type: 'arrived' }]).phase).toBe('opening')
    expect(run([{ type: 'select', id: 'ibs-library' }, { type: 'arrived' }, { type: 'shown' }])).toEqual({ id: 'ibs-library', phase: 'open' })
  })

  it('단계를 건너뛰는 이벤트는 무시한다 (도착 전에 shown, 닫힌 채로 arrived)', () => {
    expect(run([{ type: 'shown' }])).toEqual(CLOSED)
    expect(run([{ type: 'arrived' }])).toEqual(CLOSED)
    expect(run([{ type: 'select', id: 'a' }, { type: 'shown' }]).phase).toBe('flying')
  })

  it('닫기(X·ESC·바깥 클릭·뒤로가기)는 closing 을 거쳐 closed 로 간다', () => {
    const open: DetailState = { id: 'expo-bridge', phase: 'open' }
    const closing = run([{ type: 'close' }], open)
    expect(closing).toEqual({ id: 'expo-bridge', phase: 'closing' })
    expect(run([{ type: 'closed' }], closing)).toEqual(CLOSED)
  })

  it('카메라가 다가가는 중에도 닫을 수 있다', () => {
    expect(run([{ type: 'select', id: 'a' }, { type: 'close' }]).phase).toBe('closing')
  })

  it('닫혀 있을 때의 close, 닫는 중의 close 는 그대로(두 번 눌러도 안전)', () => {
    expect(run([{ type: 'close' }])).toEqual(CLOSED)
    const closing: DetailState = { id: 'a', phase: 'closing' }
    expect(run([{ type: 'close' }], closing)).toBe(closing)
  })

  it('열려 있는 동안 다른 모형을 눌러도 바뀌지 않는다', () => {
    const open: DetailState = { id: 'a', phase: 'open' }
    expect(run([{ type: 'select', id: 'b' }], open)).toBe(open)
    const closing: DetailState = { id: 'a', phase: 'closing' }
    expect(run([{ type: 'select', id: 'b' }], closing)).toBe(closing)
  })

  it('닫힌 뒤에는 다시 열 수 있다', () => {
    const state = run([{ type: 'select', id: 'a' }, { type: 'arrived' }, { type: 'shown' }, { type: 'close' }, { type: 'closed' }, { type: 'select', id: 'b' }])
    expect(state).toEqual({ id: 'b', phase: 'flying' })
  })

  it('보이는 단계는 closed 를 뺀 모두', () => {
    expect(isDetailVisible(CLOSED)).toBe(false)
    expect(isDetailVisible({ id: 'a', phase: 'flying' })).toBe(true)
    expect(isDetailVisible({ id: 'a', phase: 'closing' })).toBe(true)
  })
})

describe('URL ?place=<id> 동기화', () => {
  const ids = ['science-museum', 'expo-bridge']

  it('알려진 장소 id 만 읽고 나머지는 null', () => {
    expect(placeIdFromSearch('?place=expo-bridge', ids)).toBe('expo-bridge')
    expect(placeIdFromSearch('?x=1&place=science-museum', ids)).toBe('science-museum')
    expect(placeIdFromSearch('?place=nope', ids)).toBeNull()
    expect(placeIdFromSearch('?place=', ids)).toBeNull()
    expect(placeIdFromSearch('', ids)).toBeNull()
  })

  it('place 를 넣고 빼도 다른 검색 값은 그대로', () => {
    expect(searchWithPlace('', 'expo-bridge')).toBe('?place=expo-bridge')
    expect(searchWithPlace('?debug=landmarks', 'expo-bridge')).toBe('?debug=landmarks&place=expo-bridge')
    expect(searchWithPlace('?debug=landmarks&place=expo-bridge', null)).toBe('?debug=landmarks')
    expect(searchWithPlace('?place=expo-bridge', null)).toBe('')
  })

  it('이미 있는 place 는 새 값으로 바뀐다', () => {
    expect(searchWithPlace('?place=science-museum', 'expo-bridge')).toBe('?place=expo-bridge')
  })
})

describe('닫는 입력', () => {
  it('ESC 키만 닫는다', () => {
    expect(shouldCloseOnKey('Escape')).toBe(true)
    expect(shouldCloseOnKey('Esc')).toBe(true)
    expect(shouldCloseOnKey('Enter')).toBe(false)
    expect(shouldCloseOnKey('Tab')).toBe(false)
  })

  it('모바일 시트는 80px 이상 끌어야 닫힌다', () => {
    expect(shouldCloseSheet(79)).toBe(false)
    expect(shouldCloseSheet(80)).toBe(true)
    expect(shouldCloseSheet(200)).toBe(true)
    expect(shouldCloseSheet(-30)).toBe(false)
  })
})
