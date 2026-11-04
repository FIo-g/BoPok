// 외부 호출·환경 파일 없이 지정한 오프라인 자료만 읽는다.
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { lockTestDatabase } from './test-db-lock.mjs'
import { TEST_DB_DIR, TEST_BACKUP_DIR } from './test-db-paths.mjs'
const { values } = parseArgs({ options: { source: { type: 'string' }, 'apply-test': { type: 'boolean', default: false } } })
if (!values.source) throw Error('--source 조사자료 폴더를 지정해 주세요.')
const require = createRequire(import.meta.url)
createRequire(require.resolve('drizzle-kit'))('tsx/cjs/api').register()
const { planResearch, applyResearch, hashResearch } = require('../../src/lib/places/research-import.ts')
const { PGlite } = require('@electric-sql/pglite')
const { drizzle } = require('drizzle-orm/pglite')
const { migrate } = require('drizzle-orm/pglite/migrator')
const schema = require('../../src/lib/db/schema/index.ts')
const { insertPilotPlaces } = require('../../src/lib/places/seed.ts')
const { getPlaceDetails } = require('../../src/lib/places/index.ts')
const { sql } = require('drizzle-orm')
const source = resolve(values.source)
const read = async name => JSON.parse(await readFile(join(source, name), 'utf8'))
const inputName = '보폭_대전108_출처별정리_20261103.json'
const data = await read(inputName)
const manifest = await read('manifest.json')
const { createHash } = await import('node:crypto')
for (const name of [inputName, 'osm/daejeon-collected-features.geojson', 'knps/sutonggol-2017-segments.geojson']) {
  const entry = manifest.files.find(item => item.path === name)
  if (!entry || createHash('sha256').update(await readFile(join(source, name))).digest('hex') !== entry.sha256) throw Error(`SHA256 불일치 ${name}`)
}
const pilots = await Promise.all(['hanbat', 'art', 'leeungno'].map(async id => JSON.parse(await readFile(`data/places/${id}.json`, 'utf8'))))
const plan = planResearch(data, await read('osm/daejeon-collected-features.geojson'), pilots.map(p => ({ ...p, lng: p.coord[0], lat: p.coord[1] })))
const knps = await read('knps/sutonggol-2017-segments.geojson')
if (knps.type !== 'FeatureCollection' || knps.features.length !== 14) throw Error('KNPS 좌표묶음 형식/개수 불일치')
knps.features.forEach((feature, index) => plan.rows.push({ namespace: plan.namespace, entity: 'knpsGeometry', externalId: String(index), placeId: null, hash: hashResearch(feature), data: feature }))
const report = { mode: values['apply-test'] ? 'test-db' : 'dry-run', ...plan.report, records: plan.rows.length }
await mkdir('data/services/research-20261103', { recursive: true })
if (values['apply-test']) {
  // 대상은 고정된 독립 테스트 경로다. DATABASE_URL과 기존 다른 PGlite DB는 사용하지 않는다.
  const release = await lockTestDatabase()
  let client
  try {
    client = new PGlite(TEST_DB_DIR)
    await client.waitReady
    const db = drizzle(client, { schema })
    // 테스트 DB도 다음 실행 전의 전체 복구본을 남긴다. 기존 파일을 덮어쓰지 않는다.
    const backup = await client.dumpDataDir()
    await mkdir(TEST_BACKUP_DIR, { recursive: true })
    report.backup = join(TEST_BACKUP_DIR, `research-test-backup-${Date.now()}.tar.gz`)
    await writeFile(report.backup, Buffer.from(await backup.arrayBuffer()), { flag: 'wx' })
    await migrate(db, { migrationsFolder: './drizzle' })
    await insertPilotPlaces(db, pilots)
    report.first = await applyResearch(db, plan)
    report.second = await applyResearch(db, plan)
    // 카탈로그를 함께 넣은 뒤에는 이름순 첫 100곳에 시범 장소가 없을 수 있다.
    const ids = [...new Set(plan.mapping.flatMap(item => item.dbId ? [item.dbId] : []))]
    const details = await getPlaceDetails(ids, db)
    const [{ count }] = await db.select({ count: sql`count(*)`.mapWith(Number) }).from(schema.places)
    report.databasePlaces = count
    report.detailsWithResearchNotice = details.filter(p => p.research).length
    report.existingPreserved = pilots.every(p => details.some(row => row.id === p.id && JSON.stringify(row.coord) === JSON.stringify(p.coord)))
    if (!report.existingPreserved || report.second.added || report.second.recordsAdded) throw Error('기존 자료 보존/중복 검사 실패')
  } finally { try { await client?.close() } finally { await release() } }
}
await writeFile(`data/services/research-20261103/${values['apply-test'] ? 'applied' : 'dry-run'}.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, mapping: undefined }, null, 2))
