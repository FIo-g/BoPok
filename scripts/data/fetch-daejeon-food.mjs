import { createRequire } from 'node:module'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)

async function main() {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string' }, offline: { type: 'boolean', default: false },
    'max-requests': { type: 'string', default: '1000' }, help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log(`대전시 음식점·카페·메뉴 공개 API 수집 (인증키 불필요)
실행: node --use-system-ca --conditions=react-server scripts/data/fetch-daejeon-food.mjs
--snapshot 이름      같은 이름의 캐시부터 이어서 수집 (기본: 한국 날짜)
--offline            외부 호출 없이 저장된 페이지만 사용
--max-requests 횟수  이번 실행의 외부 요청 상한 (기본: 1000)
안내: data/services/README.md`)
    return
  }
  const snapshot = values.snapshot ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(snapshot)) throw new Error('스냅샷 이름 형식 오류')
  const require = createRequire(import.meta.url)
  createRequire(require.resolve('drizzle-kit'))('tsx/cjs/api').register()
  const { collectDaejeonFood, CachedFoodPageSchema, DaejeonFoodError } = require('../../src/lib/places/daejeon-food.ts')
  const output = join(root, 'data/raw/daejeon-food', snapshot)
  const cacheDir = join(output, 'pages')
  await mkdir(cacheDir, { recursive: true })
  const lockPath = join(output, '.collect.lock')
  const lock = await open(lockPath, 'wx')
  const partialPath = join(output, 'catalog.jsonl.part')
  let stream
  async function save(path, value) {
    await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', 'utf8')
    await rename(`${path}.tmp`, path)
  }
  const manifest = { schemaVersion: 1, provider: 'daejeon-food', region: '대전광역시', snapshot,
    startedAt: new Date().toISOString(), complete: false, status: 'running', collected: 0, requests: 0 }
  try {
    stream = await open(partialPath, 'w')
    await save(join(output, 'manifest.json'), manifest)
    const result = await collectDaejeonFood({
      maxRequests: values.offline ? 0 : Number(values['max-requests']),
      cache: {
        read: async pageNo => {
          let content
          try { content = await readFile(join(cacheDir, `${pageNo}.json`), 'utf8') } catch (error) {
            if (error.code === 'ENOENT') return null
            throw new DaejeonFoodError('저장된 페이지를 읽지 못했습니다.')
          }
          try { return CachedFoodPageSchema.parse(JSON.parse(content)) } catch {
            throw new DaejeonFoodError('저장된 페이지 형식을 확인하지 못했습니다.')
          }
        },
        write: async (pageNo, value) => { await save(join(cacheDir, `${pageNo}.json`), value) },
      },
      onEntry: async entry => { await stream.writeFile(JSON.stringify(entry) + '\n', 'utf8') },
      onProgress: (collected, total, requests) => {
        Object.assign(manifest, { collected, total, requests })
        if (collected === total || collected % 1000 === 0) console.log(`대전 식당·카페 ${collected}/${total}곳 · 이번 요청 ${requests}회`)
      },
    })
    await stream.close()
    stream = null
    await rename(partialPath, join(output, 'catalog.jsonl'))
    Object.assign(manifest, result, { status: 'complete', finishedAt: new Date().toISOString() })
    console.log(JSON.stringify(result, null, 2))
    console.log(`결과: data/raw/daejeon-food/${snapshot}/catalog.jsonl`)
  } catch (error) {
    manifest.status = 'incomplete'
    console.error(error instanceof DaejeonFoodError ? error.message : '수집 파일 저장에 실패했습니다.')
    console.error('완료된 페이지는 보존했습니다. 같은 --snapshot으로 다시 실행하면 이어서 수집합니다.')
    process.exitCode = 1
  } finally {
    try {
      await stream?.close()
      await save(join(output, 'manifest.json'), { ...manifest, stoppedAt: new Date().toISOString() })
    } finally {
      await lock.close()
      await unlink(lockPath)
    }
  }
}

main().catch(() => {
  console.error('실행 조건·명령 인자·수집 잠금 파일을 확인해 주세요. --help로 사용법을 볼 수 있습니다.')
  process.exitCode = 1
})
