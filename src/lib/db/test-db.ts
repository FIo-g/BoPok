// 테스트 전용 DB. 메모리 PGlite를 띄워 drizzle/의 마이그레이션을 적용하고,
// getDb()가 이 연결을 쓰도록 globalThis에 심는다 (앱 코드는 바뀌지 않는다).
// `.test.ts`가 아니라 여기 둔 이유: 여러 테스트 파일이 같이 쓴다
// (src/lib/engine/test-fixtures.ts와 같은 방식).
import 'server-only'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { Db } from './client'
import * as schema from './schema'

// 레포 루트의 drizzle/ — 테스트를 어느 폴더에서 돌려도 찾게 이 파일 위치에서 계산한다.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url))

export type TestDb = {
  db: Db
  /** 모든 테이블을 비운다. PGlite를 띄우는 데 1.6초가 걸리니 테스트마다 새로 띄우지 말고
   *  파일당 한 번 띄운 뒤(beforeAll) 테스트 사이에는 이것만 부른다(beforeEach). */
  reset: () => Promise<void>
  close: () => Promise<void>
}

// public 스키마의 모든 테이블을 한 문장으로 비운다. 테이블 이름을 적지 않으므로
// 나중에 표가 늘어도(trips·places …) 이 함수는 그대로 쓸 수 있다.
const TRUNCATE_ALL = sql`
  do $$
  declare stmt text;
  begin
    select 'truncate table ' || string_agg(format('%I', tablename), ', ') || ' cascade'
      into stmt from pg_tables where schemaname = 'public';
    if stmt is not null then execute stmt; end if;
  end $$;
`

export async function setupTestDb(): Promise<TestDb> {
  const client = new PGlite('memory://')
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })

  // getDb()·getAuth()가 보관해 둔 연결을 이 메모리 DB로 바꿔 끼운다.
  // __bopokAuth도 지운다 — 남아 있으면 예전 DB를 쥔 로그인 인스턴스를 계속 쓴다.
  const store = globalThis as typeof globalThis & { __bopokDb?: Db }
  Reflect.deleteProperty(globalThis, '__bopokAuth')
  store.__bopokDb = db

  return {
    db,
    reset: async () => {
      await db.execute(TRUNCATE_ALL)
    },
    close: async () => {
      Reflect.deleteProperty(globalThis, '__bopokDb')
      Reflect.deleteProperty(globalThis, '__bopokAuth')
      await client.close()
    },
  }
}
