import { defineConfig } from 'drizzle-kit'

// 마이그레이션은 먼저 개인 Neon 브랜치에서 돌려 본다 (AGENTS.md 8장).
export default defineConfig({
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
