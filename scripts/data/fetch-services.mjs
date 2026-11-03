// 공개 API 원본과 추천용 자료를 수집한다. 서비스 DB는 열거나 수정하지 않는다.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)

async function main() {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string' }, 'max-requests': { type: 'string', default: '900' }, types: { type: 'string', default: '32,39' },
    offline: { type: 'boolean', default: false }, 'include-pet': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log(`대전 식당·카페·숙박 TourAPI 수집
실행: node --use-system-ca --env-file-if-exists=.env.local --conditions=react-server scripts/data/fetch-services.mjs
--snapshot 이름       같은 이름으로 실행하면 페이지 캐시부터 이어서 수집 (기본: 한국 날짜)
--types 32,39         관광지(12)·문화시설(14)·숙박(32)·음식점(39) 선택 (기본: 32,39)
--max-requests 횟수   이번 실행의 외부 요청 상한 (기본: 900, API 오류는 재시도하지 않음)
--offline             외부 호출 없이 기존 캐시만 사용
--include-pet         장소별 반려동물 정보도 수집
인증키: .env.local의 TOURAPI_SERVICE_KEY (명령 인자에 키를 넣지 않음)
안내: data/services/README.md`)
    return
  }
  const snapshot = values.snapshot ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(snapshot)) throw new Error('스냅샷 이름은 영문·숫자·밑줄·하이픈 64자 이내로 지정해 주세요.')
  const contentTypes = values.types.split(',').map(type => type.trim())
  if (!contentTypes.length || contentTypes.some(type => !['12', '14', '32', '39'].includes(type)) || new Set(contentTypes).size !== contentTypes.length) {
    throw new Error('수집 분류는 12,14,32,39 중 중복 없이 지정해 주세요.')
  }
  const require = createRequire(import.meta.url)
  createRequire(require.resolve('drizzle-kit'))('tsx/cjs/api').register()
  const { TourApiClient, CachedTourApiPageSchema, TourApiError } = require('../../src/lib/places/tourapi.ts')
  const { collectServiceCatalog } = require('../../src/lib/places/service-catalog.ts')
  const output = join(root, 'data/raw/tourapi/daejeon-services', snapshot)
  const cachePath = join(output, 'pages')
  await mkdir(cachePath, { recursive: true })
  await mkdir(join(output, 'entries'), { recursive: true })
  const lockPath = join(output, '.collect.lock')
  async function save(path, value) {
    const temporary = `${path}.tmp`
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8')
    await rename(temporary, path)
  }
  const cacheFile = key => join(cachePath, `${createHash('sha256').update(key).digest('hex')}.json`)
  const api = new TourApiClient({
    ...(values.offline ? { apiKey: '' } : {}),
    maxRequests: values.offline ? 0 : Number(values['max-requests']),
    cache: {
      read: async key => {
        let content
        try { content = await readFile(cacheFile(key), 'utf8') } catch (error) {
          if (error.code === 'ENOENT') return null
          throw new TourApiError('invalid_response', '저장된 페이지 파일을 읽지 못했습니다.')
        }
        try { return CachedTourApiPageSchema.parse(JSON.parse(content)) } catch {
          throw new TourApiError('invalid_response', '저장된 페이지 파일 형식을 확인하지 못했습니다.')
        }
      },
      write: async (key, value) => { await save(cacheFile(key), value) },
    },
  })
  let lock
  try { lock = await open(lockPath, 'wx') } catch {
    throw new Error('같은 스냅샷의 수집이 실행 중이거나 잠금 파일이 남아 있습니다. 기존 실행을 확인해 주세요.')
  }
  const manifest = { schemaVersion: 1, provider: 'tourapi', region: '대전광역시', snapshot,
    includePet: values['include-pet'], contentTypes, startedAt: new Date().toISOString(), complete: false,
    status: 'running', listCounts: {}, collected: 0, requests: 0, cacheHits: 0 }
  const entries = []
  try {
    await save(join(output, 'manifest.json'), manifest)
    const result = await collectServiceCatalog(api, {
      contentTypes,
      includePet: values['include-pet'],
      onList: async (type, count) => {
        manifest.listCounts[type] = count
        await save(join(output, 'manifest.json'), manifest)
        console.log(`${({ '12': '관광지', '14': '문화시설', '39': '음식점·카페', '32': '숙박' })[type]} 목록 ${count}곳`)
      },
      onEntry: async entry => {
        await save(join(output, 'entries', `${entry.id}.json`), entry)
        entries.push(entry)
        manifest.collected = entries.length
        if (entries.length % 25 === 0) console.log(`상세 수집 ${entries.length}곳 · 이번 외부 요청 ${api.requests}회`)
      },
    })
    Object.assign(manifest, result, { status: 'complete', finishedAt: new Date().toISOString() })
    await save(join(output, 'catalog.json'), { ...manifest, entries: entries.sort((a, b) => a.id.localeCompare(b.id)) })
    console.log(`수집 완료: ${entries.length}곳 · 외부 요청 ${api.requests}회 · 캐시 ${api.cacheHits}페이지`)
    console.log(`결과: data/raw/tourapi/daejeon-services/${snapshot}/catalog.json`)
  } catch (error) {
    manifest.status = 'incomplete'
    manifest.errorCode = error instanceof TourApiError ? error.code : 'local_error'
    console.error(error instanceof TourApiError ? error.message : '수집 결과를 저장하지 못했습니다. 로컬 파일 접근 상태를 확인해 주세요.')
    console.error('완료된 원본 페이지는 보존했습니다. 같은 --snapshot으로 다시 실행하면 이어서 수집합니다.')
    process.exitCode = 1
  } finally {
    try {
      Object.assign(manifest, { requests: api.requests, cacheHits: api.cacheHits, stoppedAt: new Date().toISOString() })
      await save(join(output, 'manifest.json'), manifest)
    } finally {
      await lock.close()
      await unlink(lockPath)
    }
  }
}

main().catch(() => {
  console.error('수집 명령 인자·로컬 파일·실행 조건을 확인해 주세요. --help로 실행 방법을 볼 수 있습니다.')
  process.exitCode = 1
})
