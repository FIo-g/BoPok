import 'server-only'
import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

export type Db = NeonHttpDatabase<typeof schema>

let db: Db | undefined

// 처음 부를 때 연결을 만든다. import 시점에 만들면 DB 주소 없이 빌드할 때 터지기 때문.
export function getDb(): Db {
  if (db) return db
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL이 없습니다. .env.local에 Neon 연결 주소를 넣어 주세요 (.env.example 참고).')
  }
  db = drizzle(neon(url), { schema })
  return db
}
