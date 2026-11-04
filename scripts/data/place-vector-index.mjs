import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
async function main() {
  const { values } = parseArgs({ options: {
    'install-schema': { type: 'boolean', default: false }, index: { type: 'boolean', default: false },
    limit: { type: 'string', default: '16' }, kind: { type: 'string' }, 'max-requests': { type: 'string', default: '0' }, help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log(`장소 벡터 검색 준비 (기본: 읽기 전용 상태 확인)
node --use-system-ca --env-file-if-exists=.env.local --conditions=react-server scripts/data/place-vector-index.mjs
--install-schema       main에 머지된 Neon 전용 벡터 SQL만 적용
--index                Upstage 임베딩 생성·저장 (원문·모델이 같은 항목은 건너뜀)
--kind lodging         이 종류만 처리 (attraction, restaurant, cafe, lodging)
--limit 16             한 번에 처리할 장소 수 (최대 20000)
--max-requests 1       외부 임베딩 요청 상한. 기본 0이라 유료 API를 자동 호출하지 않음`)
    return
  }
  const require = createRequire(import.meta.url)
  createRequire(require.resolve('drizzle-kit'))('tsx/cjs/api').register()
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).hostname.endsWith('.neon.tech')) throw new Error('공용 Neon 설정을 확인해 주세요.')
  const { neon } = require('@neondatabase/serverless')
  const connection = neon(process.env.DATABASE_URL)
  const path = 'scripts/data/sql/place-embeddings.sql'
  if (values['install-schema'] || values.index) {
    let merged
    try { merged = execFileSync('git', ['show', `origin/main:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch {
      throw new Error('벡터 SQL을 먼저 main에 머지해야 합니다.')
    }
    if (merged.replaceAll('\r\n', '\n') !== (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')) throw new Error('main과 벡터 SQL이 다릅니다.')
  }
  if (values['install-schema']) {
    for (const statement of (await readFile(path, 'utf8')).split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement)
  }
  const status = (await connection.query("select to_regclass('public.place_catalog') is not null as catalog_ready, to_regclass('public.place_embeddings') is not null as vectors_ready"))[0]
  console.log(JSON.stringify(status))
  if (!values.index) return
  const maxRequests = Number(values['max-requests'])
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error('외부 요청 상한을 1 이상 명시해 주세요.')
  if (!status.catalog_ready || !status.vectors_ready) throw new Error('main의 장소·벡터 테이블과 자료 적재를 먼저 완료해 주세요.')
  const { getDb } = require('../../src/lib/db/client.ts')
  const { indexPlaceEmbeddings } = require('../../src/lib/places/embeddings.ts')
  console.log(JSON.stringify(await indexPlaceEmbeddings(getDb(), { limit: Number(values.limit), maxRequests, kind: values.kind })))
}
main().catch(() => {
  console.error('Neon·Upstage 설정과 main 반영 여부·테이블·호출 상한을 확인해 주세요. 인증값과 외부 오류 원문은 출력하지 않았습니다.')
  process.exitCode = 1
})
