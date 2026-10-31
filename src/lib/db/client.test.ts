import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

// getDb()가 globalThis에 두는 연결을 테스트마다 비운다
afterEach(() => {
  Reflect.deleteProperty(globalThis, '__bopokDb')
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('dbKind', () => {
  it('DATABASE_URL이 없으면 로컬 PGlite', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { dbKind } = await import('./client')
    expect(dbKind()).toBe('pglite')
  })

  it('DATABASE_URL이 있으면 Neon (배포)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@example.neon.tech/db')
    const { dbKind } = await import('./client')
    expect(dbKind()).toBe('neon')
  })
})

describe('getDb', () => {
  it('import만으로는 DB를 열지 않는다 (빌드 통과)', async () => {
    vi.stubEnv('DATABASE_URL', '')
    await import('./client')
    expect(Reflect.has(globalThis, '__bopokDb')).toBe(false)
  })

  // 첫 WASM 초기화가 느린 환경에서도 실제 쿼리를 검증할 시간을 확보한다.
  it('DATABASE_URL 없이도 로컬 PGlite로 쿼리가 된다', async () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('PGLITE_DIR', 'memory://')
    const { getDb } = await import('./client')
    // 날 SQL(execute)의 결과는 드라이버마다 타입이 달라 unknown이다. 앱 코드는 타입이 붙는 쿼리 빌더를 쓴다.
    const result = await getDb().execute(sql`select 1 as one`)
    expect(result).toMatchObject({ rows: [{ one: 1 }] })
  }, 30000)

  it('다시 부르면 같은 연결', async () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('PGLITE_DIR', 'memory://')
    const { getDb } = await import('./client')
    expect(getDb()).toBe(getDb())
  })

  it('개발 서버가 코드를 다시 불러와도(HMR) 같은 연결 — PGlite 폴더를 두 번 열지 않게', async () => {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('PGLITE_DIR', 'memory://')
    const first = (await import('./client')).getDb()
    vi.resetModules()
    const second = (await import('./client')).getDb()
    expect(second).toBe(first)
  })
})
