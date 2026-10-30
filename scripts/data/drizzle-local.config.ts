import { defineConfig } from 'drizzle-kit'

// 기본 설정과 같은 통합 스키마를 사용하되 비밀 파일과 외부 DB는 사용하지 않는다.
export default defineConfig({
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: { url: '.pglite' },
})
