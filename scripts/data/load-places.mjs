// 공개 장소 자료를 별도 로컬 PGlite에만 넣는다. 환경 파일과 외부 DB는 읽지 않는다.
import { createRequire } from 'node:module'
import { readFile, readdir, access, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const { values } = parseArgs({ options: { ids: { type: 'string' } } })
try {
  await access(join(root, '.next/dev/lock'))
  throw new Error('개발 서버를 종료한 뒤 장소 데이터를 적재해 주세요.')
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
}
const requested = values.ids ? values.ids.split(',').map(id => id.trim()) : null
if (requested?.some(id => !id)) throw new Error('빈 장소 ID는 허용하지 않습니다.')
const require = createRequire(import.meta.url)
const requireKit = createRequire(require.resolve('drizzle-kit'))
requireKit('tsx/cjs/api').register()
const { PilotPlaceSchema, insertPilotPlaces } = require('../../src/lib/places/seed.ts')
const files = (await readdir(join(root, 'data/places'))).filter(name => name.endsWith('.json')).sort()
const all = []
for (const name of files) all.push(PilotPlaceSchema.parse(JSON.parse(await readFile(join(root, 'data/places', name), 'utf8'))))
const entries = requested ? requested.map(id => {
  const entry = all.find(place => place.id === id)
  if (!entry) throw new Error(`장소 파일을 찾을 수 없습니다: ${id}`)
  return entry
}) : all
if (!entries.length) throw new Error('적재할 장소가 없습니다.')

// 과거 스키마 실험 DB를 덮어쓰지 않고, 프론트와 API가 함께 사용할 경로를 고정한다.
process.env.DATABASE_URL = ''
process.env.PGLITE_DIR = '.pglite/places-api'
// PGlite는 상위 폴더를 만들지 않으므로(새 체크아웃에는 .pglite가 없다) 하위 폴더까지 먼저 만든다.
await mkdir(join(root, process.env.PGLITE_DIR), { recursive: true })
const { getDb } = require('../../src/lib/db/client.ts')
const { migrate } = require('drizzle-orm/pglite/migrator')
const db = getDb()
try {
  await migrate(db, { migrationsFolder: join(root, 'drizzle') })
  const result = await insertPilotPlaces(db, entries)
  console.log(JSON.stringify({ database: process.env.PGLITE_DIR, ...result }, null, 2))
} finally {
  await db.$client.close()
}
