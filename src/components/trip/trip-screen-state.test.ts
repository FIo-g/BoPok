import { describe, expect, it } from 'vitest'
import type { ExplainResponse, TripVersion } from '@/lib/contracts'
import { explainTextToShow, preloadedVersion, showScheduleSpinner } from './trip-screen-state'

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

describe('explainTextToShow', () => {
  const fixedNone: ExplainResponse = { text: '바뀐 점 없음', source: 'fixed' }

  it('일정 칸에서 바뀐 곳이 있으면 "바뀐 점 없음"은 숨긴다', () => {
    expect(explainTextToShow(fixedNone, ['새로 넣은 곳: 점심 후 휴식'])).toBeNull()
  })

  it('정말 아무것도 안 바뀌었으면 "바뀐 점 없음"을 그대로 둔다', () => {
    expect(explainTextToShow(fixedNone, [])).toBe('바뀐 점 없음')
  })

  it('AI 문장이나 다른 고정 문장은 일정 칸 변화와 상관없이 그대로 둔다', () => {
    expect(explainTextToShow({ text: '점심이 30분 늦어져요', source: 'ai' }, ['시간 바뀜: 점심 식사 12:30 → 12:00'])).toBe('점심이 30분 늦어져요')
    expect(explainTextToShow({ text: '계단 구간 1곳을 우회로로 변경', source: 'fixed' }, ['뺀 곳: 이응노미술관'])).toBe('계단 구간 1곳을 우회로로 변경')
  })

  it('설명이 아직 없으면 null', () => {
    expect(explainTextToShow(null, ['뺀 곳: 이응노미술관'])).toBeNull()
  })
})
