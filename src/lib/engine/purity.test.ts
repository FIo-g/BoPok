import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// 엔진은 서버뿐 아니라 브라우저에서 바로 돈다(판정이 화면에 도착하는 길, common.md 4장).
// 그래서 React·DB·fetch·환경 변수·서버 전용 표시를 하나도 쓰면 안 된다.
const FORBIDDEN = [
  /from ['"]react/,
  /from ['"]@\/lib\/db/,
  /from ['"]server-only['"]/,
  /process\.env/,
  /\bfetch\(/,
  /from ['"]next\//,
]

// 테스트 파일은 FORBIDDEN 패턴 문자를 포함하므로 검사에서 뺀다.
function tsSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name)
    if (entry.isDirectory()) return tsSources(filePath)
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) return [filePath]
    return []
  })
}

describe('엔진 순수성', () => {
  it('엔진은 React·DB·fetch·환경 변수를 쓰지 않는다', () => {
    const dir = new URL('.', import.meta.url).pathname
    const offenders = tsSources(dir).flatMap((filePath) => {
      const text = readFileSync(filePath, 'utf8')
      return FORBIDDEN.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${relative(dir, filePath)}: /${pattern.source}/`,
      )
    })
    expect(offenders).toEqual([])
  })
})
