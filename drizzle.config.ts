import { defineConfig } from 'drizzle-kit'

// drizzle-kit은 .env만 읽는다. 팀은 키를 .env.local에 두므로 직접 불러온다 (없으면 넘어감).
try {
  process.loadEnvFile('.env.local')
} catch {}

// 마이그레이션은 먼저 개인 Neon 브랜치에서 돌려 본다 (AGENTS.md 8장).
export default defineConfig({
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
