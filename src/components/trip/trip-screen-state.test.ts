import { describe, expect, it } from 'vitest'
import { showScheduleSpinner } from './trip-screen-state'

describe('showScheduleSpinner', () => {
  it('버전이 없는 여행은 버전을 기다리지 않으므로 계산 중 표시를 띄우지 않는다 (무한 로딩 회귀 방지)', () => {
    // activeId 가 null 이면 버전 요청은 꺼져 있어서 versionLoading 이 항상 true 로 들어온다
    expect(showScheduleSpinner({ activeId: null, versionLoading: true, hasStops: false, canJudge: true })).toBe(false)
    expect(showScheduleSpinner({ activeId: null, versionLoading: true, hasStops: false, canJudge: false })).toBe(false)
  })

  it('고른 안을 받는 중이면 띄운다', () => {
    expect(showScheduleSpinner({ activeId: 'v-1', versionLoading: true, hasStops: false, canJudge: true })).toBe(true)
  })

  // 지금 화면에서는 일정과 여행자가 있으면 판정 결과도 바로 있어 이 분기까지 오지 않는다. 예전 조건을 그대로 지키는지만 본다
  it('일정이 있고 판정할 수 있는데 판정 결과가 아직 없으면 띄운다 (예전 조건 유지)', () => {
    expect(showScheduleSpinner({ activeId: 'v-1', versionLoading: false, hasStops: true, canJudge: true })).toBe(true)
  })

  it('일정이 있어도 여행자가 없어 판정할 수 없으면 띄우지 않는다', () => {
    expect(showScheduleSpinner({ activeId: 'v-1', versionLoading: false, hasStops: true, canJudge: false })).toBe(false)
  })

  it('안도 일정도 없고 받는 중도 아니면 띄우지 않는다', () => {
    expect(showScheduleSpinner({ activeId: 'v-1', versionLoading: false, hasStops: false, canJudge: true })).toBe(false)
  })
})
