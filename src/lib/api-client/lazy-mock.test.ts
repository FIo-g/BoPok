import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/mocks/seed'
import type { Api } from './types'

// 목업은 켠 빌드에서만 불러온다 (끈 빌드의 번들에 목업 데이터·연습용 비밀번호가 들어가지 않게)
beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('목업 늦게 불러오기', () => {
  it('켜면 첫 호출 때 목업을 불러와 그대로 쓴다', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '1')
    const { lazyMockApi } = await import('./lazy-mock')
    expect(await lazyMockApi.auth.getSession()).toBeNull()
    const user = await lazyMockApi.auth.signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    expect(user.email).toBe(DEMO_EMAIL)
    expect((await lazyMockApi.groups.list()).length).toBeGreaterThan(0)
  })

  it('끄면 목업을 불러오지 않고 오류로 알린다', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '')
    const { lazyMockApi } = await import('./lazy-mock')
    await expect(lazyMockApi.auth.getSession()).rejects.toThrow('NEXT_PUBLIC_USE_MOCKS')
  })

  it('불러오지 못했으면 다음 호출에서 다시 시도한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '')
    const { lazyMockApi } = await import('./lazy-mock')
    await expect(lazyMockApi.auth.getSession()).rejects.toThrow()
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '1')
    expect(await lazyMockApi.auth.getSession()).toBeNull()
  })

  it('실제 API 와 같은 이름의 메서드를 모두 가진다', async () => {
    const { lazyMockApi } = await import('./lazy-mock')
    const { realApi } = await import('./real')
    for (const group of Object.keys(realApi) as (keyof Api)[]) {
      expect(Object.keys(lazyMockApi[group]).sort()).toEqual(Object.keys(realApi[group]).sort())
    }
  })
})

describe('목업 본체를 정적으로 가져오지 않는다', () => {
  const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

  it('api-client/index.ts 와 lazy-mock.ts 에는 @/mocks 정적 import 가 없다', () => {
    expect(read('./index.ts')).not.toMatch(/from\s+['"]@\/mocks/)
    expect(read('./lazy-mock.ts')).not.toMatch(/from\s+['"]@\/mocks/)
  })
})
