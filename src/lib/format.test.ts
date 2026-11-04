import { describe, expect, it } from 'vitest'
import type { Transport } from '@/lib/contracts'
import { countRideLegsWithoutTime, formatRideMin, formatWalk, hasWalkInfoGap, isWalkInfoMissing, formatDateRange, loginRedirectPath, placeWalkDistanceText, requireUserRedirect, sourceName, stopStairsState } from './format'

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

  it('TMAP 은 경로 종류로 가린다: 자가용·택시 구간은 보행자 경로가 아니다', () => {
    expect(sourceName('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1')).toBe('TMAP 보행자 경로')
    expect(sourceName('https://apis.openapi.sk.com/tmap/routes?version=1')).toBe('TMAP 자동차 경로')
    expect(sourceName('https://apis.openapi.sk.com/tmap/routes/?version=1')).toBe('TMAP 자동차 경로')
    expect(sourceName('https://apis.openapi.sk.com/tmap/pois?version=1')).toBe('TMAP')
    expect(sourceName('https://apis.openapi.sk.com')).toBe('TMAP')
  })

  it('자동차 경로 출처도 근거 줄로 보여 준다', async () => {
    const { sourceLine } = await import('./format')
    expect(sourceLine('https://apis.openapi.sk.com/tmap/routes?version=1', '2026-11-02')).toBe('출처: TMAP 자동차 경로 · 2026.11 확인')
  })
})

describe('탈것 이동 시간 문장', () => {
  it('1분이 안 되는 짧은 구간은 0분이 아니라 1분 이내', () => {
    expect(formatRideMin(0.3)).toBe('약 1분 이내 · 추정치')
    expect(formatRideMin(0)).toBe('약 1분 이내 · 추정치')
    expect(formatRideMin(0.99)).toBe('약 1분 이내 · 추정치')
  })

  it('1분 이상은 반올림한 분과 추정치', () => {
    expect(formatRideMin(1)).toBe('약 1분 · 추정치')
    expect(formatRideMin(1.4)).toBe('약 1분 · 추정치')
    expect(formatRideMin(12.5)).toBe('약 13분 · 추정치')
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

describe('로그인이 필요한 화면에서 보낼 곳', () => {
  const me = { id: 'u-1' }

  it('확인 중이거나 로그인했으면 보내지 않는다', () => {
    expect(requireUserRedirect(undefined, false, '/trips/t1', '')).toBeNull()
    expect(requireUserRedirect(me, false, '/trips/t1', '')).toBeNull()
    expect(requireUserRedirect(me, true, '/trips/t1', '')).toBeNull()
  })

  it('로그인 안 했으면 지금 화면으로 돌아오게 로그인 화면으로', () => {
    expect(requireUserRedirect(null, false, '/trips/t1', '')).toBe('/login?next=%2Ftrips%2Ft1')
  })

  it('로그아웃 버튼으로 나갔으면 next 없이 첫 화면으로 (다음 사람이 남의 여행으로 돌아가지 않게)', () => {
    expect(requireUserRedirect(null, true, '/trips/t1', '?x=1')).toBe('/')
  })
})

describe('placeWalkDistanceText', () => {
  const lengths = { a: 420, b: 800, c: 100 }
  it('돌아가는 길과 같은 구간은 한 번만 더한다', () => {
    expect(placeWalkDistanceText([{ segmentId: 'a', reverse: false }, { segmentId: 'b', reverse: false }, { segmentId: 'b', reverse: true }], lengths)).toBe('약 1.2km')
  })
  it('1km 보다 짧으면 m 로 보여 준다', () => {
    expect(placeWalkDistanceText([{ segmentId: 'a', reverse: false }], lengths)).toBe('약 420m')
  })
  it('구간 데이터가 없으면 null', () => {
    expect(placeWalkDistanceText([], lengths)).toBeNull()
    expect(placeWalkDistanceText([{ segmentId: 'x', reverse: false }], lengths)).toBeNull()
  })
})

describe('formatDateRange', () => {
  it('여러 날이면 기간과 박·일을 보여 준다', () => {
    expect(formatDateRange('2026-11-14', '2026-11-16')).toBe('2026년 11월 14일 (토) ~ 2026년 11월 16일 (월) · 2박 3일')
  })
  it('하루짜리·끝 날짜 없음·날짜 미정은 시작일만', () => {
    expect(formatDateRange('2026-11-14', null)).toBe('2026년 11월 14일 (토)')
    expect(formatDateRange('2026-11-14', '2026-11-14')).toBe('2026년 11월 14일 (토)')
    expect(formatDateRange(null, null)).toBe('날짜 미정')
  })
})
