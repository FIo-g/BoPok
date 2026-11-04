// 기본은 파일 검사만 한다. 공용 DB 쓰기는 main 반영 여부를 확인한 뒤에만 허용한다.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { lockTestDatabase } from './test-db-lock.mjs'
import { TEST_DB_DIR, TEST_BACKUP_DIR } from './test-db-paths.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
async function main() {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string', default: '2026-11-03' }, apply: { type: 'boolean', default: false },
    'attractions-snapshot': { type: 'string', default: '2026-11-03-attractions' },
    'verify-memory': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    'apply-test': { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log(`수집 자료 → 공용 장소 계약 적재
기본: node --conditions=react-server scripts/data/load-service-catalog.mjs (파일 검사만)
--snapshot 이름    수집 스냅샷 선택 (기본: 2026-11-03)
--attractions-snapshot 이름    관광지·문화시설 스냅샷 (기본: 2026-11-03-attractions)
--verify-memory    새 메모리 PGlite에서 전체 적재·재실행 검사, 디스크·공용 DB는 사용하지 않음
--apply-test       .pglite/daejeon-20261103-main-test에만 백업 후 적재·재실행·추천·가격 확인 (3001 서버 종료 후)
--apply            main에 머지된 마이그레이션이 공용 DB에 적용된 뒤 자료 적재, 마이그레이션을 실행하지 않음`)
    return
  }
  if ([values.apply, values['verify-memory'], values['apply-test']].filter(Boolean).length > 1) throw new Error('실제 적재·메모리 검사·테스트 적재는 별도 실행해 주세요.')
  for (const name of [values.snapshot, values['attractions-snapshot']]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('스냅샷 이름 형식을 확인해 주세요.')
  }
  const require = createRequire(import.meta.url)
  createRequire(require.resolve('drizzle-kit'))('tsx/cjs/api').register()
  const { prepareFoodCatalog, prepareTourCatalog, importPreparedCatalog } = require('../../src/lib/places/catalog-import.ts')
  const foodRoot = join(root, 'data/raw/daejeon-food', values.snapshot)
  const lodgingRoot = join(root, 'data/raw/tourapi/daejeon-services', values.snapshot)
  const foodManifest = JSON.parse(await readFile(join(foodRoot, 'manifest.json'), 'utf8'))
  const lodging = JSON.parse(await readFile(join(lodgingRoot, 'catalog.json'), 'utf8'))
  const attractions = JSON.parse(await readFile(join(root, 'data/raw/tourapi/daejeon-services', values['attractions-snapshot'], 'catalog.json'), 'utf8'))
  const canonical = JSON.parse(await readFile(join(root, 'data/services/canonical-tourapi.json'), 'utf8'))
  if (foodManifest.complete !== true || lodging.complete !== true || attractions.complete !== true) throw new Error('완료된 수집 스냅샷만 적재합니다.')
  const entries = []
  const lines = createInterface({ input: createReadStream(join(foodRoot, 'catalog.jsonl')), crlfDelay: Infinity })
  for await (const line of lines) if (line.trim()) entries.push(prepareFoodCatalog(JSON.parse(line)))
  const foodCount = entries.length
  if (foodCount !== foodManifest.collected) throw new Error('음식점 파일의 전체 건수가 수집 기록과 다릅니다.')
  for (const entry of lodging.entries) entries.push(prepareTourCatalog(entry))
  for (const entry of attractions.entries) {
    const match = canonical[entry.contentId]
    if (match && entry.name !== match.tourName) throw new Error('수동 장소 연결의 TourAPI 이름을 다시 확인해 주세요.')
    const curated = match ? JSON.parse(await readFile(join(root, 'data/places', `${match.placeId}.json`), 'utf8')) : undefined
    entries.push(prepareTourCatalog(entry, curated))
  }
  if (new Set(entries.map(entry => entry.summary.id)).size !== entries.length) throw new Error('장소 ID가 중복되었습니다.')
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : values['verify-memory'] ? 'memory-test' : values['apply-test'] ? 'test-db' : 'dry-run',
    places: entries.length, foodPlaces: foodCount, lodgingPlaces: lodging.entries.length, attractionPlaces: attractions.entries.length,
    menus: entries.reduce((total, entry) => total + entry.menus.length, 0) }, null, 2))
  if (!values.apply && !values['verify-memory'] && !values['apply-test']) return
  if (values['verify-memory'] || values['apply-test']) {
    const { PGlite } = require('@electric-sql/pglite')
    const { drizzle } = require('drizzle-orm/pglite')
    const { migrate } = require('drizzle-orm/pglite/migrator')
    const schema = require('../../src/lib/db/schema/index.ts')
    const release = values['apply-test'] ? await lockTestDatabase() : async () => {}
    let client
    try {
      client = new PGlite(values['apply-test'] ? TEST_DB_DIR : 'memory://')
      await client.waitReady
      const db = drizzle(client, { schema })
      if (values['apply-test']) {
        const backup = await client.dumpDataDir()
        await mkdir(TEST_BACKUP_DIR, { recursive: true })
        await writeFile(join(TEST_BACKUP_DIR, `catalog-test-backup-${Date.now()}.tar.gz`), Buffer.from(await backup.arrayBuffer()), { flag: 'wx' })
      }
      await migrate(db, { migrationsFolder: join(root, 'drizzle') })
      const { insertPilotPlaces, PilotPlaceSchema } = require('../../src/lib/places/seed.ts')
      const pilots = await Promise.all(Object.values(canonical).map(async value => PilotPlaceSchema.parse(
        JSON.parse(await readFile(join(root, 'data/places', `${value.placeId}.json`), 'utf8')),
      )))
      await insertPilotPlaces(db, pilots)
      const firstImport = await importPreparedCatalog(db, entries)
      const repeatedImport = await importPreparedCatalog(db, entries)
      const { recommendServicePlaces } = require('../../src/lib/places/recommendations.ts')
      const { getPlaceCostChoices } = require('../../src/lib/places/cost-choices.ts')
      const recommendationCounts = {}
      // 검증 명령은 외부 임베딩을 호출하지 않고 종류·동선의 실제 DB 연결만 확인한다.
      for (const kind of ['restaurant', 'cafe', 'lodging']) {
        const result = await recommendServicePlaces({ kind, near: [127.38, 36.35] }, { db })
        if (result.items.some(item => item.place.kind !== kind)) throw new Error('추천 분류 검증 실패')
        recommendationCounts[kind] = result.items.length
      }
      const sampleIds = entries.filter(entry => entry.menus.some(menu => menu.priceKrw !== undefined)).slice(0, 3).map(entry => entry.summary.id)
      sampleIds.push(...entries.filter(entry => entry.summary.kind === 'lodging').map(entry => entry.summary.id))
      const priceChoices = await getPlaceCostChoices({ ids: sampleIds }, db)
      const { sql } = require('drizzle-orm')
      const [{ totalPlaces }] = await db.select({ totalPlaces: sql`count(*)`.mapWith(Number) }).from(schema.places)
      const report = { sharedDbWritten: false, totalPlaces, firstImport, repeatedImport, recommendationCounts, pricePlacesChecked: priceChoices.length,
        placesWithPriceOptions: priceChoices.filter(entry => entry.options.length).length,
        unknownMenuUnitsPreserved: priceChoices.flatMap(entry => entry.options).filter(option => option.kind === 'meal').every(option => option.unit === 'unspecified') }
      if (values['apply-test']) await writeFile('data/services/catalog-integration-test.json', JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report))
    } finally { try { await client?.close() } finally { await release() } }
    return
  }
  // 작업 브랜치의 미검토 마이그레이션을 공용 Neon에 적용하지 않는다 (AGENTS 8장).
  const migrationPath = 'drizzle/0005_place-services-research.sql'
  let merged
  try { merged = execFileSync('git', ['show', `origin/main:${migrationPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch {
    throw new Error('장소 마이그레이션을 먼저 main에 머지해야 합니다. 공용 DB는 변경하지 않았습니다.')
  }
  if (merged.replaceAll('\r\n', '\n') !== (await readFile(migrationPath, 'utf8')).replaceAll('\r\n', '\n')) {
    throw new Error('현재 마이그레이션과 main의 내용이 다릅니다. 공용 DB는 변경하지 않았습니다.')
  }
  if (!process.env.DATABASE_URL) throw new Error('공용 Neon DATABASE_URL을 설정해 주세요.')
  const address = new URL(process.env.DATABASE_URL)
  if (!address.hostname.endsWith('.neon.tech')) throw new Error('공용 Neon 연결주소를 확인해 주세요.')
  const { getDb } = require('../../src/lib/db/client.ts')
  const { hasPlaceCatalog } = require('../../src/lib/places/index.ts')
  const db = getDb()
  if (!await hasPlaceCatalog(db)) throw new Error('main의 장소 마이그레이션을 적용한 뒤 자료를 적재해 주세요.')
  console.log(JSON.stringify(await importPreparedCatalog(db, entries)))
}
await main().catch(() => {
  console.error('수집 파일·공용 계약·main 마이그레이션 반영 상태를 확인해 주세요. 공용 DB 마이그레이션은 이 명령에서 실행하지 않습니다.')
  process.exitCode = 1
})
