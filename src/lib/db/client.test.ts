import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('getDb', () => {
  it('import만으로는 에러가 나지 않는다 (DB 주소 없이도 빌드 통과)', async () => {
    vi.stubEnv('DATABASE_URL', '')
    await expect(import('./client')).resolves.toHaveProperty('getDb')
  })

  it('DATABASE_URL이 없으면 원인을 알려 주는 에러', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { getDb } = await import('./client')
    expect(() => getDb()).toThrow(/DATABASE_URL/)
  })

  it('DATABASE_URL이 있으면 연결 객체를 만들고 다시 부르면 같은 것을 준다', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@example.neon.tech/db')
    const { getDb } = await import('./client')
    expect(getDb()).toBe(getDb())
  })
})
