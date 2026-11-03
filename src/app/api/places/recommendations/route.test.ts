import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ loggedIn: false }))
vi.mock('@/lib/auth', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/auth')>()
  return { ...original, requireUser: vi.fn(async () => {
    if (!state.loggedIn) throw new original.HttpError(401, 'unauthorized', '로그인이 필요해요.')
    return { userId: 'test-user', userName: '가상 사용자' }
  }) }
})
vi.mock('@/lib/places/recommendations', () => ({ recommendServicePlaces: vi.fn(async () => ({
  catalogReady: true, method: 'keyword', distanceBasis: 'straight_line', routeCheckRequired: true, items: [],
})) }))
import { recommendServicePlaces } from '@/lib/places/recommendations'
import { POST } from './route'
beforeEach(() => { state.loggedIn = false; vi.clearAllMocks() })

describe('추천 API 경계', () => {
  it('로그인 전에는 임베딩 호출을 하지 않는다', async () => {
    expect((await POST(new Request('http://localhost/api/places/recommendations', { method: 'POST' }))).status).toBe(401)
    expect(recommendServicePlaces).not.toHaveBeenCalled()
  })
  it('임의 분류와 초과 검색 건수는 호출 전에 거절한다', async () => {
    state.loggedIn = true
    for (const body of [{ kind: 'unknown' }, { kind: 'lodging', limit: 21 }]) {
      expect((await POST(new Request('http://localhost/api/places/recommendations', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }))).status).toBe(400)
    }
    expect(recommendServicePlaces).not.toHaveBeenCalled()
  })
})
