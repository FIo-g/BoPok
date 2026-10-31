import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_EMAIL, DEMO_PASSWORD } from './seed'

// 화면이 쓰는 연습용 계정(src/mocks/index.ts)은 목업을 켠 빌드에서만 값이 있다
beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('연습용 계정 (src/mocks/index.ts)', () => {
  it('목업을 켠 빌드에서는 시드(seed.ts)의 계정과 같다', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '1')
    const demo = await import('./index')
    expect(demo.DEMO_EMAIL).toBe(DEMO_EMAIL)
    expect(demo.DEMO_PASSWORD).toBe(DEMO_PASSWORD)
  })

  it('끈 빌드에서는 빈 문자열이다', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '')
    const demo = await import('./index')
    expect(demo.DEMO_EMAIL).toBe('')
    expect(demo.DEMO_PASSWORD).toBe('')
  })

  it('다른 모듈을 가져오지 않는다 (화면이 이 파일을 가져와도 목업 데이터가 번들에 딸려 오지 않게)', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/\b(import|export)\b[^\n]*\bfrom\b/)
  })
})
