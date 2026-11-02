import { describe, expect, it } from 'vitest'
import type { TripVersion } from '@/lib/contracts'
import { preloadedVersion, showScheduleSpinner } from './trip-screen-state'

const version = (id: string): TripVersion => ({
  id, tripId: 't-1', number: 1, parentId: null, madeBy: 'user', stops: [], createdAt: '2026-11-02T00:00:00+09:00',
})

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

describe('preloadedVersion', () => {
  it('고른 안과 처음 안의 id가 같으면 처음 안을 그대로 돌려준다', () => {
    const initial = version('v-1')
    expect(preloadedVersion(initial, 'v-1')).toBe(initial)
  })

  it('다른 안을 고르면 처음 안을 쓰지 않는다 (null이면 버전 API로 받는다)', () => {
    expect(preloadedVersion(version('v-1'), 'v-2')).toBeNull()
  })

  it('처음 안이 없으면(버전이 없는 여행) null', () => {
    expect(preloadedVersion(null, null)).toBeNull()
    expect(preloadedVersion(null, 'v-1')).toBeNull()
  })

  it('처음 안 값이 아직 없으면(여행 정보를 받기 전) null', () => {
    expect(preloadedVersion(undefined, 'v-1')).toBeNull()
    expect(preloadedVersion(undefined, null)).toBeNull()
  })

  it('고른 안이 없으면 처음 안이 있어도 null', () => {
    expect(preloadedVersion(version('v-1'), null)).toBeNull()
  })
})
