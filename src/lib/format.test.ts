import { describe, expect, it } from 'vitest'
import { formatWalk, stopStairsState } from './format'

const seg = (stairsStatus: 'present' | 'confirmed_none' | 'unknown', reverse = false) => ({ stairsStatus, reverse })

describe('stopStairsState', () => {
  it('계단이 하나라도 있으면 present', () => {
    expect(stopStairsState([seg('confirmed_none'), seg('present')])).toBe('present')
  })

  it('모두 확인된 없음이면 confirmed_none', () => {
    expect(stopStairsState([seg('confirmed_none'), seg('confirmed_none')])).toBe('confirmed_none')
  })

  it('기록 없는 구간이 섞이면 unknown', () => {
    expect(stopStairsState([seg('confirmed_none'), seg('unknown')])).toBe('unknown')
  })

  it('구간이 없으면 unknown', () => {
    expect(stopStairsState([])).toBe('unknown')
  })
})
describe('걷는 시간 문장', () => {
  it('길 정보가 없어 아무것도 계산되지 않았으면 0분이 아니라 정보 없음', () => {
    expect(formatWalk({ base: 0, high: 0 }, 'info')).toBe('정보 없음')
  })

  it('계산된 값은 범위로 보여 준다', () => {
    expect(formatWalk({ base: 18, high: 21.6 }, 'adjust')).toBe('약 18~22분')
    expect(formatWalk({ base: 10, high: 12 }, 'info')).toBe('약 10~12분')
  })

  it('조건을 충족하는 일정의 0분은 그대로 보여 준다', () => {
    expect(formatWalk({ base: 0, high: 0 }, 'ok')).toBe('약 0분')
  })
})

describe('출처 이름', () => {
  it('주소는 읽기 쉬운 이름으로, 이름은 그대로', async () => {
    const { sourceLine } = await import('./format')
    expect(sourceLine('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', '2026-10-31')).toBe('출처: TMAP 보행자 경로 · 2026.10 확인')
    expect(sourceLine('https://www.daejeon.go.kr/gar/contentsHtmlView.do?menuSeq=8026', '2026-10-31')).toBe('출처: daejeon.go.kr · 2026.10 확인')
    expect(sourceLine('현장 확인', '2026-10')).toBe('출처: 현장 확인 · 2026.10 확인')
    expect(sourceLine('', '2026-10')).toBe('출처 확인 중')
  })
})
