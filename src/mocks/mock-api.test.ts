import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError } from '@/lib/api-client/http'
import { mockApi as api } from './mock-api'
import { DEMO_EMAIL, DEMO_INVITE_TOKEN, DEMO_PASSWORD } from './seed'
import { resetMockDb } from './store'

// 서버 없이 화면이 쓰는 가짜 API 의 권한·흐름 (localStorage 가 없는 Node 에서는 메모리만 쓴다)
async function loginDemo() {
  await api.auth.signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
}

describe('목업 API', () => {
  beforeEach(() => resetMockDb())

  it('로그인 전에는 401, 로그인 뒤에는 내 그룹이 보인다', async () => {
    await expect(api.groups.list()).rejects.toMatchObject({ status: 401 })
    await loginDemo()
    const groups = await api.groups.list()
    expect(groups.map(g => g.name)).toEqual(['우리 가족', '이모네 가족'])
    expect(groups[0].role).toBe('owner')
    expect(groups[1].role).toBe('member')
  })

  it('틀린 비밀번호는 401', async () => {
    const error = await api.auth.signIn({ email: DEMO_EMAIL, password: 'wrong' }).catch((e: unknown) => e)
    expect(isApiError(error) && error.status).toBe(401)
  })

  it('가입한 새 사람은 그룹이 없고, 남의 그룹은 403', async () => {
    await api.auth.signUp({ name: '새 사람', email: 'new@bopok.test', password: 'secret12' })
    expect(await api.groups.list()).toEqual([])
    await expect(api.groups.get('g-family')).rejects.toMatchObject({ status: 403 })
    await expect(api.trips.get('t-daejeon')).rejects.toMatchObject({ status: 403 })
  })

  it('초대 링크로 참가하면 그룹이 보이고, 이미 구성원이어도 성공한다', async () => {
    await api.auth.signUp({ name: '새 사람', email: 'new@bopok.test', password: 'secret12' })
    expect((await api.invites.preview(DEMO_INVITE_TOKEN)).groupName).toBe('이모네 가족')
    const { groupId } = await api.invites.accept(DEMO_INVITE_TOKEN)
    await api.invites.accept(DEMO_INVITE_TOKEN)
    expect((await api.groups.get(groupId)).members.map(m => m.name)).toContain('새 사람')
  })

  it('없는 초대는 404', async () => {
    await expect(api.invites.preview('nope')).rejects.toMatchObject({ status: 404 })
  })

  it('초대 링크는 그룹장만 만들 수 있다', async () => {
    await loginDemo()
    await expect(api.groups.createInvite('g-aunt')).rejects.toMatchObject({ status: 403 })
    const invite = await api.groups.createInvite('g-family')
    expect(invite.token.length).toBeGreaterThanOrEqual(30)
  })

  it('버전을 저장하면 번호가 이어지고 판정 요약이 붙는다', async () => {
    await loginDemo()
    const detail = await api.trips.get('t-daejeon')
    const latest = detail.versions[detail.versions.length - 1]
    const base = await api.trips.getVersion('t-daejeon', latest.id)
    const saved = await api.trips.saveVersion('t-daejeon', { parentId: base.id, stops: base.stops.slice(0, 2), madeBy: 'user', note: '두 곳만' })
    expect(saved.number).toBe(latest.number + 1)
    expect(saved.summary?.verdict).toBeDefined()
    expect(saved.madeByUserId).toBe('u-me')
  })

  it('확정은 여행당 한 버전이고 풀 수 있다', async () => {
    await loginDemo()
    await api.trips.confirm('t-daejeon', 'v-daejeon-1')
    const second = await api.trips.confirm('t-daejeon', 'v-daejeon-2')
    expect(second.confirmedVersionId).toBe('v-daejeon-2')
    expect((await api.trips.shareText('t-daejeon')).text).toContain('출발 전 운영 여부를 꼭 확인하세요')
    const open = await api.trips.unconfirm('t-daejeon')
    expect(open.confirmedVersionId).toBeNull()
    await expect(api.trips.shareText('t-daejeon')).rejects.toMatchObject({ status: 404 })
  })

  it('의견은 본인 것만 지울 수 있다', async () => {
    await loginDemo()
    await expect(api.opinions.remove('o-1')).rejects.toMatchObject({ status: 403 })
    const mine = await api.opinions.add('v-daejeon-2', { stopKey: 's-science', reactions: ['must_go'], comment: '좋아요' })
    await api.opinions.remove(mine.id)
    expect((await api.opinions.list('v-daejeon-2')).some(o => o.id === mine.id)).toBe(false)
  })

  it('다시 짜기: 의견을 반영한 새 버전이 생기고 의견에 반영됨 표시가 붙는다', async () => {
    await loginDemo()
    await api.opinions.add('v-daejeon-2', { stopKey: 's-hanbat', reactions: ['stairs_worry'], comment: null })
    const res = await api.ai.revise({ tripId: 't-daejeon', versionId: 'v-daejeon-2' })
    expect(res.version.parentId).toBe('v-daejeon-2')
    expect(res.appliedOpinionIds.length).toBeGreaterThanOrEqual(2)
    const opinions = await api.opinions.list('v-daejeon-2')
    expect(opinions.every(o => o.appliedInVersionId === res.version.id)).toBe(true)
  })

  it('붙여넣은 일정은 장소로 정리하고 못 찾은 것은 따로 돌려준다', async () => {
    await loginDemo()
    const res = await api.ai.parseSchedule({ tripId: 't-daejeon', text: '10:00 한밭수목원\n12:00 점심\n14:00 과학관\n저녁에 불꽃놀이' })
    expect(res.stops.map(s => s.placeId)).toEqual(['hanbat', 'lunch-dorong', 'science', null])
    expect(res.stops[0].startTime).toBe('10:00')
    expect(res.unmatched).toEqual(['저녁에 불꽃놀이'])
  })

  it('붙여넣기(A)도 저장된 일정을 AI가 다듬어 새 버전을 만든다', async () => {
    await loginDemo()
    const trip = await api.trips.create({ groupId: 'g-family', title: '붙여넣기 테스트', mode: 'paste' })
    const detail = await api.trips.get('t-daejeon')
    // 새 여행에는 남의 계정을 걸 수 없어서(서버 규칙) 계정 연결은 빼고 저장한다
    await api.trips.putTravelers(trip.id, detail.travelers.map(t => ({ ...t, userId: undefined })))
    const parsed = await api.ai.parseSchedule({ tripId: 't-daejeon', text: '10:00 한밭수목원\n14:00 과학관' })
    const saved = await api.trips.saveVersion(trip.id, { parentId: null, stops: parsed.stops, madeBy: 'user', note: null })
    const res = await api.ai.generate({ tripId: trip.id })
    expect(res.version.parentId).toBe(saved.id)
  })

  it('인터뷰는 칸 순서대로 질문하고, 같은 질문에 답이 두 번 와도 건너뛰지 않는다', async () => {
    await loginDemo()
    const trip = await api.trips.create({ groupId: 'g-family', title: '테스트', mode: 'scratch' })
    let q = await api.ai.interview({ tripId: trip.id })
    expect(q.slot).toBe('travelers')
    const first = q.questionId
    q = await api.ai.interview({ tripId: trip.id, questionId: first, answer: { choiceIndex: 1 } })
    expect(q.slot).toBe('traveler_age')
    const again = await api.ai.interview({ tripId: trip.id, questionId: first, answer: { choiceIndex: 1 } })
    expect(again.questionId).toBe(q.questionId)
    expect(again.slot).toBe('traveler_age')
  })
})
