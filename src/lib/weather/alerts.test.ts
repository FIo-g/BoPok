import { describe, expect, it } from 'vitest'
import { parseActiveAlerts, parsePreliminaryAlerts, parsePwnStatus } from './alerts'

const ISSUED = '2026-11-13T10:00+09:00'

describe('parseActiveAlerts (t6 특보발효현황)', () => {
  it('가이드 예제처럼 이어 붙은 글에서 대전에 걸린 육지 특보만 꺼낸다', () => {
    const t6 = 'o 강풍주의보 : 울릉도.독도  o 한파경보 : 서울, 대전, 세종, 충청남도(천안, 공주)  o 풍랑주의보 : 서해중부앞바다, 대전'
    expect(parseActiveAlerts(t6, ISSUED)).toEqual([{ kind: '한파', grade: 'warning', when: null, issuedAt: ISSUED }])
  })

  it('줄바꿈으로 나뉜 글, 중대경보·주의보, 대전광역시 표기', () => {
    const t6 = 'o 폭염중대경보 : 대전광역시, 세종\no 호우주의보 : 대전\no 건조주의보 : 대전'
    expect(parseActiveAlerts(t6, ISSUED).map(a => [a.kind, a.grade])).toEqual([
      ['폭염', 'severe'],
      ['호우', 'advisory'],
    ])
  })

  it('대전이 다른 낱말 안에만 있거나 특보가 없으면 빈 목록', () => {
    expect(parseActiveAlerts('o 대설주의보 : 대전동, 대전리', ISSUED)).toEqual([])
    expect(parseActiveAlerts('o 없음', ISSUED)).toEqual([])
    expect(parseActiveAlerts('', ISSUED)).toEqual([])
  })
})

describe('parsePreliminaryAlerts (t7 예비특보)', () => {
  it('종류·날짜·때를 꺼내고, 대전이 없는 줄은 뺀다', () => {
    const t7 = '(1) 한파 예비특보  o 11월 14일 아침 : 서울, 대전, 세종  o 11월 15일 아침 : 강원도  (2) 풍랑 예비특보  o 11월 14일 밤 : 서해중부먼바다'
    expect(parsePreliminaryAlerts(t7, '2026-11-13', ISSUED)).toEqual([
      { date: '2026-11-14', alert: { kind: '한파', grade: 'preliminary', when: '아침', issuedAt: ISSUED } },
    ])
  })

  it('12월에 낸 1월 예비특보는 다음 해 날짜다', () => {
    const t7 = '(1) 대설 예비특보 o 01월 02일 오후 : 대전'
    expect(parsePreliminaryAlerts(t7, '2026-12-31', ISSUED)[0].date).toBe('2027-01-02')
  })

  it('예비특보가 없으면 빈 목록', () => {
    expect(parsePreliminaryAlerts('o 없음', '2026-11-13', ISSUED)).toEqual([])
  })
})

describe('parsePwnStatus', () => {
  it('발표 시각으로 issuedAt을 정하고 t6·t7을 함께 읽는다', () => {
    const parsed = parsePwnStatus({ tmFc: 202611131000, t6: 'o 강풍주의보 : 대전', t7: '(1) 대설 예비특보 o 11월 15일 새벽 : 대전' })
    expect(parsed.active).toEqual([{ kind: '강풍', grade: 'advisory', when: null, issuedAt: ISSUED }])
    expect(parsed.preliminary).toEqual([{ date: '2026-11-15', alert: { kind: '대설', grade: 'preliminary', when: '새벽', issuedAt: ISSUED } }])
  })

  it('발표 시각이 이상하면 아무것도 꺼내지 않는다', () => {
    expect(parsePwnStatus({ tmFc: 'x', t6: 'o 강풍주의보 : 대전' })).toEqual({ active: [], preliminary: [] })
  })
})
