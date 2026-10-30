import 'server-only'
import { PGlite } from '@electric-sql/pglite'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import * as schema from './schema'

// Neon과 PGlite 모두 PostgreSQL이라 같은 쿼리 코드를 쓴다.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
export type DbKind = 'neon' | 'pglite'

// 개발은 각자 로컬 PGlite(.pglite 폴더), 배포 때만 DATABASE_URL에 Neon 주소를 넣는다.
export function dbKind(): DbKind {
  return process.env.DATABASE_URL ? 'neon' : 'pglite'
}

// 개발 서버가 코드를 다시 불러와도(HMR) 같은 연결을 쓰도록 globalThis에 둔다.
// PGlite 폴더를 두 곳에서 동시에 열면 데이터가 망가진다.
const store = globalThis as typeof globalThis & { __bopokDb?: Db }

// 처음 부를 때 연결을 만든다. import 시점에 만들면 빌드할 때 DB를 열게 된다.
export function getDb(): Db {
  if (store.__bopokDb) return store.__bopokDb
  const url = process.env.DATABASE_URL
  store.__bopokDb = url
    ? drizzleNeon(neon(url), { schema })
    : drizzlePglite(new PGlite(process.env.PGLITE_DIR || '.pglite'), { schema })
  return store.__bopokDb
}
