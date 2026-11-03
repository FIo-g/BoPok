import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ loggedIn: false }))
vi.mock('@/lib/auth', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/auth')>()
  return { ...original, requireUser: vi.fn(async () => {
    if (!state.loggedIn) throw new original.HttpError(401, 'unauthorized', '로그인이 필요해요.')
    return { userId: 'test-user', userName: '가상 사용자' }
  }) }
})
vi.mock('@/lib/geo/taxi-cost', () => ({ quoteTaxiCosts: vi.fn(async () => []) }))
import { quoteTaxiCosts } from '@/lib/geo/taxi-cost'
import { POST } from './route'
beforeEach(() => { state.loggedIn = false; vi.clearAllMocks() })
describe('택시 비용 API 경계', () => {
  it('미로그인은 외부 경로 호출 전에 401로 막는다', async () => {
    expect((await POST(new Request('http://localhost/api/places/taxi-costs', { method: 'POST' }))).status).toBe(401)
    expect(quoteTaxiCosts).not.toHaveBeenCalled()
  })
  it('로그인 후 잘못된 JSON·분류를 거절한다', async () => {
    state.loggedIn = true
    expect((await POST(new Request('http://localhost/api/places/taxi-costs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    }))).status).toBe(400)
    expect((await POST(new Request('http://localhost/api/places/taxi-costs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ mode: 'car' }] }),
    }))).status).toBe(400)
    expect(quoteTaxiCosts).not.toHaveBeenCalled()
  })
})
