// AI 라우트가 실제 연결(real-deps)을 쓰는지, 개발용 가짜(dev-deps)가 실제 실행에 새어 들어가지 않는지 본다.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as explain } from '@/app/api/ai/explain/route'
import { POST as generate } from '@/app/api/ai/generate/route'
import { POST as interview } from '@/app/api/ai/interview/route'
import { POST as parseSchedule } from '@/app/api/ai/parse-schedule/route'
import { POST as revise } from '@/app/api/ai/revise/route'
import { createDevDeps } from './dev-deps'

// 라우트가 부르는 getAiDeps를 가짜로 바꿔, 어느 모듈에서 가져오는지와 호출 여부만 본다.
const mocks = vi.hoisted(() => ({ getAiDeps: vi.fn() }))
vi.mock('@/lib/ai/real-deps', () => ({ getAiDeps: mocks.getAiDeps }))

describe('AI 라우트는 real-deps의 getAiDeps()로 연결 지점을 얻는다', () => {
  beforeEach(() => {
    mocks.getAiDeps.mockReset()
    mocks.getAiDeps.mockReturnValue(createDevDeps())
  })

  const routes = { interview, 'parse-schedule': parseSchedule, generate, revise, explain }

  for (const [name, post] of Object.entries(routes)) {
    it(`/api/ai/${name}`, async () => {
      const response = await post(
        new Request(`https://example.com/api/ai/${name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(mocks.getAiDeps).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(400) // 빈 요청은 형식 검사에서 막힌다 (핸들러까지 이어졌다는 뜻)
    })
  }
})

describe('개발용 가짜가 실제 실행 코드에 없다', () => {
  // src 아래 테스트가 아닌 .ts·.tsx 파일 (dev-deps.ts 자신은 뺀다)
  const srcDir = fileURLToPath(new URL('../../', import.meta.url))
  const runtimeFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && path !== 'lib/ai/dev-deps.ts')

  it('검사할 파일을 찾았다 (경로가 틀려 빈 검사가 되지 않게)', () => {
    expect(runtimeFiles.length).toBeGreaterThan(50)
    expect(runtimeFiles).toContain('lib/ai/real-deps.ts')
  })

  it('dev-deps를 import하는 실제 실행 파일이 없다', () => {
    const offenders = runtimeFiles.filter(path =>
      /from\s+['"][^'"]*dev-deps['"]/.test(readFileSync(`${srcDir}${path}`, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('가짜 로그인 헤더(x-dev-user)를 읽는 실제 실행 파일이 없다', () => {
    const offenders = runtimeFiles.filter(path => readFileSync(`${srcDir}${path}`, 'utf8').includes('x-dev-user'))
    expect(offenders).toEqual([])
  })
})
