import { defineConfig } from 'drizzle-kit'

// drizzle-kit은 .env만 읽는다. 팀은 키를 .env.local에 두므로 직접 불러온다 (없으면 넘어감).
try {
  process.loadEnvFile('.env.local')
} catch {}

const schema = './src/lib/db/schema/index.ts'
const out = './drizzle'
const url = process.env.DATABASE_URL

// DATABASE_URL이 있으면 Neon(배포), 없으면 로컬 PGlite 폴더 (src/lib/db/client.ts와 같은 규칙).
// PGlite는 한 번에 한 프로그램만 열 수 있으니 db:migrate·db:studio 전에 개발 서버를 끈다.
export default url
  ? defineConfig({ schema, out, dialect: 'postgresql', dbCredentials: { url } })
  : defineConfig({
      schema,
      out,
      dialect: 'postgresql',
      driver: 'pglite',
      dbCredentials: { url: process.env.PGLITE_DIR || '.pglite' },
    })
