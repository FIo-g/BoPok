// data/places/<id>.json의 장소 안 지점·구간을 DATABASE_URL의 공용 Neon DB에 넣는다.
// 기본은 dry-run(읽기만): 넣을 개수와 지금 DB 상태만 출력한다. --apply를 줄 때만 쓴다.
// 실행: node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id hanbat [--apply]
// 접속 주소·키는 출력하지 않는다. 장소가 DB에 있고 지점·구간이 0개인 경우에만 넣는다 (fillPlaceInside).
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const { values } = parseArgs({ options: { id: { type: 'string' }, apply: { type: 'boolean', default: false } } })
const id = values.id
if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('--id 장소 ID를 주세요. 예: --id hanbat')

const url = process.env.DATABASE_URL
// 로컬 PGlite로 잘못 넣지 않도록 공용 Neon 주소인지 먼저 확인한다 (주소 자체는 출력하지 않는다).
if (!url || !(() => { try { return new URL(url).hostname.endsWith('.neon.tech') } catch { return false } })()) {
  throw new Error('공용 Neon 설정(DATABASE_URL)을 확인해 주세요. 로컬 DB에는 넣지 않습니다.')
}

const require = createRequire(import.meta.url)
const requireKit = createRequire(require.resolve('drizzle-kit'))
requireKit('tsx/cjs/api').register()
const { PilotPlaceSchema } = require('../../src/lib/places/seed.ts')
const { fillPlaceInside } = require('../../src/lib/places/inside.ts')
const { neon } = require('@neondatabase/serverless')

const entry = PilotPlaceSchema.parse(JSON.parse(await readFile(join(root, 'data/places', `${id}.json`), 'utf8')))
const sql = neon(url)

// 지금 DB 상태 (읽기 전용)
const tables = (await sql.query("select to_regclass('public.place_nodes') is not null as nodes_ready, to_regclass('public.place_segments') is not null as segments_ready"))[0]
const status = { placeInDb: false, nodesInDb: null, segmentsInDb: null }
const placeRows = await sql.query('select id from places where id = $1', [entry.id])
status.placeInDb = placeRows.length > 0
if (tables.nodes_ready && tables.segments_ready) {
  status.nodesInDb = Number((await sql.query('select count(*)::int as n from place_nodes where place_id = $1', [entry.id]))[0].n)
  status.segmentsInDb = Number((await sql.query('select count(*)::int as n from place_segments where place_id = $1', [entry.id]))[0].n)
} else {
  status.nodesInDb = 'table_missing'
  status.segmentsInDb = 'table_missing'
}

const plan = {
  placeId: entry.id,
  file: `data/places/${entry.id}.json`,
  nodesInFile: entry.nodes.length,
  segmentsInFile: entry.segments.length,
  detourSegmentsInFile: entry.segments.filter(segment => segment.detourOf !== undefined).length,
  coursesInFile: (entry.courses ?? []).length,
  coursesStored: false, // 코스를 저장하는 표가 없다
  db: status,
  wouldFill: status.placeInDb && status.nodesInDb === 0 && status.segmentsInDb === 0,
}

if (!values.apply) {
  console.log(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2))
  console.log('쓰기는 하지 않았습니다. 넣으려면 --apply를 주세요(총괄 확인 후).')
} else {
  if (!tables.nodes_ready || !tables.segments_ready) throw new Error('main의 장소 안 표(place_nodes, place_segments)를 먼저 마이그레이션해 주세요.')
  const { getDb } = require('../../src/lib/db/client.ts')
  const result = await fillPlaceInside(getDb(), entry)
  console.log(JSON.stringify({ mode: 'apply', ...result }, null, 2))
}
