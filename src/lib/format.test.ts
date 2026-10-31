import { describe, expect, it } from 'vitest'
import type { Transport } from '@/lib/contracts'
import { countRideLegsWithoutTime, formatWalk, hasWalkInfoGap, isWalkInfoMissing, loginRedirectPath, stopStairsState } from './format'

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

describe('걷는 시간 정보 없음', () => {
  it('판정이 정보 부족이고 합계가 0이면 정보 없음', () => {
    expect(isWalkInfoMissing({ base: 0, high: 0 }, 'info')).toBe(true)
  })

  it('조건 충족·조정 필요의 0분이나 계산된 값은 정보 없음이 아니다', () => {
    expect(isWalkInfoMissing({ base: 0, high: 0 }, 'ok')).toBe(false)
    expect(isWalkInfoMissing({ base: 0, high: 0 }, 'adjust')).toBe(false)
    expect(isWalkInfoMissing({ base: 10, high: 12 }, 'info')).toBe(false)
  })
})

describe('탈것 구간 시간 모름', () => {
  const leg = (mode: Transport, rideMin: number | null) => ({ mode, rideMin })

  it('차·택시·버스 중 이동 시간을 모르는 것만 센다', () => {
    expect(countRideLegsWithoutTime([leg('car', null), leg('taxi', null), leg('bus', null)])).toBe(3)
  })

  it('이동 시간을 아는 탈것은 세지 않는다 (0분도 아는 값)', () => {
    expect(countRideLegsWithoutTime([leg('car', 12), leg('taxi', 0)])).toBe(0)
  })

  it('걷기 구간은 세지 않는다', () => {
    expect(countRideLegsWithoutTime([leg('walk', null)])).toBe(0)
  })

  it('섞여 있으면 모르는 탈것만 센다', () => {
    expect(countRideLegsWithoutTime([leg('walk', null), leg('car', 12), leg('bus', null)])).toBe(1)
  })

  it('구간이 없으면 0', () => {
    expect(countRideLegsWithoutTime([])).toBe(0)
  })
})

describe('걷는 시간 합계가 일부만 계산됐는지', () => {
  it('받지 못한 경로도 길 정보 없는 장소도 없으면 아니다', () => {
    expect(hasWalkInfoGap({ missingLegs: [], unknownStopKeys: [] })).toBe(false)
  })

  it('받지 못한 걷는 경로가 있으면 일부만 계산된 것', () => {
    expect(hasWalkInfoGap({ missingLegs: [{ fromStopKey: 'a', toStopKey: 'b', legKey: null }], unknownStopKeys: [] })).toBe(true)
  })

  it('길 정보가 없는 장소가 있으면 일부만 계산된 것', () => {
    expect(hasWalkInfoGap({ missingLegs: [], unknownStopKeys: ['b'] })).toBe(true)
  })
})

describe('로그인 후 돌아올 주소', () => {
  it('경로와 쿼리를 함께 next 로 담는다', () => {
    const url = loginRedirectPath('/trips/new', '?group=g1')
    expect(url).toBe('/login?next=%2Ftrips%2Fnew%3Fgroup%3Dg1')
    // 로그인 화면이 풀어 읽은 값이 원래 주소와 같아야 한다
    expect(new URL(url, 'http://localhost').searchParams.get('next')).toBe('/trips/new?group=g1')
  })

  it('쿼리가 여러 개여도 그대로 보존한다', () => {
    const url = loginRedirectPath('/trips/new', '?group=g1&x=a b')
    expect(new URL(url, 'http://localhost').searchParams.get('next')).toBe('/trips/new?group=g1&x=a b')
  })

  it('쿼리가 없으면 경로만', () => {
    expect(loginRedirectPath('/groups', '')).toBe('/login?next=%2Fgroups')
    expect(loginRedirectPath('/groups', '?')).toBe('/login?next=%2Fgroups')
  })
})
