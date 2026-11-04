// 같은 PGlite 파일을 서버와 두 수집기가 동시에 열지 않게 한다.
import { createConnection } from 'node:net'
import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TEST_IMPORT_LOCK } from './test-db-paths.mjs'
export async function lockTestDatabase() {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3001 })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.destroy(); reject(Error('3001 테스트 서버를 종료한 뒤 적재해 주세요.')) })
    socket.once('error', error => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED') resolve()
      else reject(Error('테스트 서버 종료 여부를 확인하지 못했습니다. 쓰기를 중단합니다.'))
    })
    socket.once('timeout', () => { socket.destroy(); reject(Error('테스트 서버 종료 확인 시간이 초과됐습니다.')) })
  })
  await mkdir(dirname(TEST_IMPORT_LOCK), { recursive: true })
  const path = TEST_IMPORT_LOCK
  let file
  try { file = await open(path, 'wx') } catch { throw Error('다른 적재가 실행 중이거나 이전 잠금이 남아 있습니다. 실행 상태를 확인해 주세요.') }
  await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  return async () => { await file.close(); await unlink(path) }
}
