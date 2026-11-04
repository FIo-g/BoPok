// 장소 안 지점·구간(·안내도 번호·층)을 DATABASE_URL의 공용 Neon DB에 넣는다.
// 입력: data/places/<id>.json(시범 장소 파일) 또는 data/places/inside/<id>.json({ placeId, nodes, segments, courses }).
// 기본은 dry-run(읽기만): 넣을 개수와 지금 DB 상태만 출력한다.
//   --apply              빈 장소에만 지점·구간을 넣는다 (fillPlaceInside). 지점·구간이 하나라도 있으면 건너뛴다.
//   --sync-labels        이미 있는 지점의 안내도 번호·층을 채운다 (syncNodeLabels). 단독이면 dry-run, --apply를 함께 주면 쓴다.
// 실행: node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id hanbat [--sync-labels] [--apply]
//       다른 장소: --id tourapi-12-125994 (data/places/inside/tourapi-12-125994.json을 먼저 build-place-inside.mjs로 만든다)
// 접속 주소·키는 출력하지 않는다. 공용 Neon 주소(.neon.tech)가 아니면 멈춘다.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'sync-labels': { type: 'boolean', default: false },
  },
})
const id = values.id
if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('--id 장소 ID를 주세요. 예: --id hanbat')

const url = process.env.DATABASE_URL
// 로컬 PGlite로 잘못 넣지 않도록 공용 Neon 주소인지 먼저 확인한다 (주소 자체는 출력하지 않는다).
if (!url || !(() => { try { return new URL(url).hostname.endsWith('.neon.tech') } catch { return false } })()) {
  throw new Error('공용 Neon 설정(DATABASE_URL)을 확인해 주세요. 로컬 DB에는 넣지 않습니다.')
}

// 시범 장소 파일이 있으면 그것을, 없으면 장소 안 전용 파일을 읽는다.
const pilotPath = join(root, 'data/places', `${id}.json`)
const insidePath = join(root, 'data/places/inside', `${id}.json`)
const inputPath = existsSync(pilotPath) ? pilotPath : insidePath
if (!existsSync(inputPath)) throw new Error(`data/places/${id}.json 또는 data/places/inside/${id}.json이 없습니다.`)

const require = createRequire(import.meta.url)
const requireKit = createRequire(require.resolve('drizzle-kit'))
requireKit('tsx/cjs/api').register()
const { PilotPlaceSchema } = require('../../src/lib/places/seed.ts')
const { fillPlaceInside, readPlaceInside, syncNodeLabels } = require('../../src/lib/places/inside.ts')
const { neon } = require('@neondatabase/serverless')

const raw = JSON.parse(await readFile(inputPath, 'utf8'))
// 시범 파일은 장소 기본 칸까지 검사하고, 전용 파일은 장소 안 칸만 검사한다. 어느 쪽이든 같은 계약으로 읽힌다.
if (inputPath === pilotPath) PilotPlaceSchema.parse(raw)
const inside = readPlaceInside(raw)
if (inside.placeId !== id) throw new Error(`파일의 장소 ID(${inside.placeId})가 --id ${id}와 다릅니다.`)
const sql = neon(url)

// 지금 DB 상태 (읽기 전용). 칸이 없으면(마이그레이션 0007 전) 쿼리를 날리지 않고 안내만 한다.
const [tables] = await sql.query(`
  select
    to_regclass('public.place_nodes') is not null as nodes_ready,
    to_regclass('public.place_segments') is not null as segments_ready,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'place_nodes' and column_name = 'guide_no') as guide_ready,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'place_nodes' and column_name = 'floor') as floor_ready
`)
const labelColumnsReady = Boolean(tables.guide_ready && tables.floor_ready)
const tablesReady = Boolean(tables.nodes_ready && tables.segments_ready)
const placeRows = await sql.query('select id from places where id = $1', [inside.placeId])
const status = {
  placeInDb: placeRows.length > 0,
  nodesInDb: tablesReady ? Number((await sql.query('select count(*)::int as n from place_nodes where place_id = $1', [inside.placeId]))[0].n) : 'table_missing',
  segmentsInDb: tablesReady ? Number((await sql.query('select count(*)::int as n from place_segments where place_id = $1', [inside.placeId]))[0].n) : 'table_missing',
  labelColumns: labelColumnsReady ? 'ready' : 'missing_run_migration_0007',
}

const plan = {
  placeId: inside.placeId,
  file: relative(root, inputPath),
  nodesInFile: inside.nodes.length,
  segmentsInFile: inside.segments.length,
  detourSegmentsInFile: inside.segments.filter(segment => segment.detourOf !== undefined).length,
  guideNumbersInFile: inside.nodes.filter(node => node.guideNo !== undefined).length,
  floorsInFile: inside.nodes.filter(node => node.floor !== undefined).length,
  db: status,
}

if (values['sync-labels']) {
  if (!labelColumnsReady) {
    console.log(JSON.stringify({ mode: 'sync-labels-dry-run', ...plan, note: '마이그레이션 0007(guide_no·floor 칸)이 아직 없습니다. main 머지 후 pnpm db:migrate를 먼저 적용해 주세요. 지금은 쓰지 않았습니다.' }, null, 2))
  } else {
    const { getDb } = require('../../src/lib/db/client.ts')
    const result = await syncNodeLabels(getDb(), raw, { dryRun: !values.apply })
    console.log(JSON.stringify({ mode: values.apply ? 'sync-labels-apply' : 'sync-labels-dry-run', ...plan, result }, null, 2))
  }
  if (!values.apply) console.log('쓰기는 하지 않았습니다. 채우려면 --sync-labels --apply를 주세요(총괄 확인 후).')
} else if (!values.apply) {
  const wouldFill = status.placeInDb && status.nodesInDb === 0 && status.segmentsInDb === 0
  console.log(JSON.stringify({ mode: 'dry-run', ...plan, wouldFill, coursesStored: false }, null, 2))
  if (!tablesReady) console.log('장소 안 표가 아직 없습니다. main의 마이그레이션을 먼저 적용해 주세요.')
  console.log('쓰기는 하지 않았습니다. 넣으려면 --apply를 주세요(총괄 확인 후).')
} else {
  if (!tablesReady) throw new Error('main의 장소 안 표(place_nodes, place_segments)를 먼저 마이그레이션해 주세요.')
  if (!labelColumnsReady) throw new Error('place_nodes에 guide_no·floor 칸이 없습니다. 마이그레이션 0007을 먼저 적용해 주세요.')
  const { getDb } = require('../../src/lib/db/client.ts')
  const result = await fillPlaceInside(getDb(), raw)
  console.log(JSON.stringify({ mode: 'apply', ...result }, null, 2))
}
