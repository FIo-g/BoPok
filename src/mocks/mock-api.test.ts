import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError } from '@/lib/api-client/http'
import { HealthListResponseSchema, TravelerHealthSchema, type Traveler, type TravelerHealthInput } from '@/lib/contracts'
import { mockApi as api } from './mock-api'
import { DEMO_EMAIL, DEMO_INVITE_TOKEN, DEMO_PASSWORD } from './seed'
import { getDb, resetMockDb } from './store'

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

  it('참가할 때 고른 관계를 서버처럼 다듬어 구성원에 저장한다', async () => {
    await api.auth.signUp({ name: '새 사람', email: 'new@bopok.test', password: 'secret12' })
    const res = await api.invites.accept(DEMO_INVITE_TOKEN, '  며느리 ')
    expect(res.alreadyMember).toBe(false)
    const me = (await api.groups.get(res.groupId)).members.find(m => m.name === '새 사람')
    expect(me?.relation).toBe('며느리')
  })

  it('관계를 안 보내거나 null 이면 비워 두고 참가한다', async () => {
    await api.auth.signUp({ name: '새 사람', email: 'new@bopok.test', password: 'secret12' })
    const { groupId } = await api.invites.accept(DEMO_INVITE_TOKEN)
    expect((await api.groups.get(groupId)).members.find(m => m.name === '새 사람')?.relation).toBeNull()

    await api.auth.signUp({ name: '또 다른 사람', email: 'other@bopok.test', password: 'secret12' })
    await api.invites.accept(DEMO_INVITE_TOKEN, null)
    expect((await api.groups.get(groupId)).members.find(m => m.name === '또 다른 사람')?.relation).toBeNull()
  })

  it('이미 구성원이면 관계를 덮어쓰지 않는다', async () => {
    await api.auth.signUp({ name: '새 사람', email: 'new@bopok.test', password: 'secret12' })
    const { groupId } = await api.invites.accept(DEMO_INVITE_TOKEN, '아들')
    const again = await api.invites.accept(DEMO_INVITE_TOKEN, '사위')
    expect(again.alreadyMember).toBe(true)
    expect((await api.groups.get(groupId)).members.find(m => m.name === '새 사람')?.relation).toBe('아들')
  })

  it('관계가 비었거나 20자를 넘으면 서버처럼 400', async () => {
    await api.auth.signUp({ name: '새 사람', email: 'new@bopok.test', password: 'secret12' })
    await expect(api.invites.accept(DEMO_INVITE_TOKEN, '   ')).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    await expect(api.invites.accept(DEMO_INVITE_TOKEN, '가'.repeat(21))).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
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

  it('여행 정보에 처음 여는 안이 전체(stops 포함)로 붙는다: 확정안이 있으면 확정안', async () => {
    await loginDemo()
    // 확정안이 최신안(v-daejeon-2)보다 오래된 안이어야 "최신"과 구분된다
    await api.trips.confirm('t-daejeon', 'v-daejeon-1')
    const detail = await api.trips.get('t-daejeon')
    expect(detail.initialVersion?.id).toBe('v-daejeon-1')
    expect(detail.initialVersion).toEqual(await api.trips.getVersion('t-daejeon', 'v-daejeon-1'))
  })

  it('처음 여는 안: 확정안이 없으면 번호가 가장 큰 최신안', async () => {
    await loginDemo()
    const detail = await api.trips.get('t-daejeon')
    expect(detail.trip.confirmedVersionId).toBeNull()
    expect(detail.initialVersion?.id).toBe('v-daejeon-2')
    expect(detail.initialVersion?.number).toBe(2)
    expect(detail.initialVersion?.stops.length).toBeGreaterThan(0)
  })

  it('처음 여는 안: 버전이 없는 여행은 null', async () => {
    await loginDemo()
    const trip = await api.trips.create({ groupId: 'g-family', title: '빈 여행', mode: 'scratch' })
    const detail = await api.trips.get(trip.id)
    expect(detail.versions).toEqual([])
    expect(detail.initialVersion).toBeNull()
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

// 건강 정보 목업: 서버(src/lib/health, src/app/api/trips/health.test.ts)와 같은 규칙을 본다.
// 가장 중요한 것: "본인만"이 다른 가족 목록에 없는 것, 남이 고치거나 지우지 못하는 것, 동의 없이는 저장되지 않는 것.
describe('목업 건강 정보 API', () => {
  beforeEach(() => resetMockDb())

  const TRIP = 't-daejeon'
  const login = (email: string) => api.auth.signIn({ email, password: DEMO_PASSWORD })
  const loginMe = () => login(DEMO_EMAIL) // u-me, tr-me 와 연결, 그룹장
  const loginMom = () => login('mom@bopok.test') // u-mom, tr-mom 과 연결
  const loginDad = () => login('dad@bopok.test') // u-dad, tr-dad 와 연결

  const input = (patch: Record<string, unknown> = {}): TravelerHealthInput =>
    ({ conditions: ['diabetes'], medicationClasses: [], visibility: 'group', consent: true, ...patch }) as TravelerHealthInput

  // 계정이 연결되지 않은 할머니를 여행자에 더한다 (서버 테스트의 t2 와 같은 자리)
  async function addGranny() {
    const detail = await api.trips.get(TRIP)
    const granny: Traveler = { id: 'tr-gran', label: '할머니', pace: 'unknown', mobilityAid: false, isParent: true, condition: {}, filledBySelf: false }
    await api.trips.putTravelers(TRIP, [...detail.travelers, granny])
  }

  const listedIds = async () => (await api.health.list(TRIP)).map(h => h.travelerId)

  it('로그인 전에는 목록·저장·지우기 모두 401', async () => {
    await expect(api.health.list(TRIP)).rejects.toMatchObject({ status: 401 })
    await expect(api.health.put(TRIP, 'tr-me', input())).rejects.toMatchObject({ status: 401 })
    await expect(api.health.remove(TRIP, 'tr-me')).rejects.toMatchObject({ status: 401 })
  })

  it('다른 그룹 사람은 목록·저장·지우기 모두 403이고 저장되지 않는다', async () => {
    await loginMe()
    await api.health.put(TRIP, 'tr-me', input())
    await api.auth.signUp({ name: '남', email: 'stranger@bopok.test', password: 'secret12' })

    await expect(api.health.list(TRIP)).rejects.toMatchObject({ status: 403 })
    await expect(api.health.put(TRIP, 'tr-me', input())).rejects.toMatchObject({ status: 403 })
    await expect(api.health.remove(TRIP, 'tr-me')).rejects.toMatchObject({ status: 403 })

    await loginMe()
    expect(await listedIds()).toEqual(['tr-me'])
  })

  it('건강 정보가 없으면 빈 목록이다', async () => {
    await loginMe()
    expect(await api.health.list(TRIP)).toEqual([])
  })

  it('동의(consent: true)가 없으면 서버처럼 400이고 저장되지 않는다', async () => {
    await loginMe()
    const { consent: _consent, ...withoutConsent } = input()
    void _consent
    for (const body of [withoutConsent, input({ consent: false }), input({ consent: 'true' })]) {
      await expect(api.health.put(TRIP, 'tr-me', body as TravelerHealthInput)).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    }
    expect(await api.health.list(TRIP)).toEqual([])
  })

  it('목록 밖 병·약·보이는 범위도 400', async () => {
    await loginMe()
    await expect(api.health.put(TRIP, 'tr-me', input({ conditions: ['cold'] }))).rejects.toMatchObject({ status: 400 })
    await expect(api.health.put(TRIP, 'tr-me', input({ medicationClasses: ['antibiotic'] }))).rejects.toMatchObject({ status: 400 })
    await expect(api.health.put(TRIP, 'tr-me', input({ visibility: 'public' }))).rejects.toMatchObject({ status: 400 })
  })

  it('정상 저장: 계약 모양으로 돌려주고 동의 날짜와 입력자는 몸체가 아니라 목업이 정한다', async () => {
    await loginMe()
    const before = Date.now()
    const saved = await api.health.put(
      TRIP, 'tr-me',
      { ...input({ conditions: ['diabetes', 'gout'], medicationClasses: ['warfarin'] }), enteredByUserId: 'someone-else', consentAt: '2000-01-01T00:00:00.000Z' } as TravelerHealthInput,
    )
    expect(TravelerHealthSchema.parse(saved)).toEqual(saved)
    expect(saved).toMatchObject({ tripId: TRIP, travelerId: 'tr-me', conditions: ['diabetes', 'gout'], medicationClasses: ['warfarin'], visibility: 'group', enteredByUserId: 'u-me' })
    expect(Date.parse(saved.consentAt)).toBeGreaterThanOrEqual(before)
    expect(HealthListResponseSchema.parse({ health: await api.health.list(TRIP) }).health).toEqual([saved])
  })

  it('가족 모두로 저장한 정보는 다른 구성원도 본다', async () => {
    await loginMom()
    await api.health.put(TRIP, 'tr-mom', input({ visibility: 'group' }))
    await loginDad()
    expect(await listedIds()).toEqual(['tr-mom'])
    await loginMe()
    expect(await listedIds()).toEqual(['tr-mom'])
  })

  it('본인만 + 계정 있는 엄마: 다른 가족 목록에는 항목 자체가 없고 엄마 본인만 받는다', async () => {
    await loginMom()
    await api.health.put(TRIP, 'tr-mom', input({ conditions: ['heart_disease'], visibility: 'self' }))
    expect(await listedIds()).toEqual(['tr-mom'])

    await loginDad()
    expect(await api.health.list(TRIP)).toEqual([])
    await loginMe()
    expect(await api.health.list(TRIP)).toEqual([])
  })

  it('엄마(계정 연결)의 건강 정보는 아들·그룹장이 넣거나 덮어쓰거나 지울 수 없다 (403)', async () => {
    await loginMe()
    await expect(api.health.put(TRIP, 'tr-mom', input())).rejects.toMatchObject({ status: 403 })
    await expect(api.health.remove(TRIP, 'tr-mom')).rejects.toMatchObject({ status: 403 })

    await loginMom()
    await api.health.put(TRIP, 'tr-mom', input({ conditions: ['hypertension'] }))

    await loginDad()
    await expect(api.health.put(TRIP, 'tr-mom', input({ conditions: ['gout'] }))).rejects.toMatchObject({ status: 403 })
    await expect(api.health.remove(TRIP, 'tr-mom')).rejects.toMatchObject({ status: 403 })
    expect((await api.health.list(TRIP))[0].conditions).toEqual(['hypertension'])
  })

  it('계정 없는 할머니: 처음 넣기는 구성원 누구나, 그다음은 처음 넣은 사람만 고치고 지운다', async () => {
    await loginMe()
    await addGranny()

    await loginDad()
    const first = await api.health.put(TRIP, 'tr-gran', input())
    expect(first.enteredByUserId).toBe('u-dad')

    await loginMe()
    await expect(api.health.put(TRIP, 'tr-gran', input({ conditions: ['gout'] }))).rejects.toMatchObject({ status: 403 })
    await expect(api.health.remove(TRIP, 'tr-gran')).rejects.toMatchObject({ status: 403 })

    await loginDad()
    const again = await api.health.put(TRIP, 'tr-gran', input({ conditions: ['gout'], visibility: 'self' }))
    expect(again).toMatchObject({ conditions: ['gout'], visibility: 'self', enteredByUserId: 'u-dad' })
  })

  it('본인만 + 계정 없는 할머니: 대신 입력한 사람만 받는다', async () => {
    await loginMe()
    await addGranny()
    await loginDad()
    await api.health.put(TRIP, 'tr-gran', input({ visibility: 'self' }))
    expect(await listedIds()).toEqual(['tr-gran'])

    await loginMe()
    expect(await api.health.list(TRIP)).toEqual([])
    await loginMom()
    expect(await api.health.list(TRIP)).toEqual([])
  })

  it('목록은 여행자 순서대로 나온다', async () => {
    await loginMe()
    await api.health.put(TRIP, 'tr-me', input())
    await loginMom()
    await api.health.put(TRIP, 'tr-mom', input())
    await loginDad()
    expect(await listedIds()).toEqual(['tr-mom', 'tr-me'])
  })

  it('없는 여행자는 404', async () => {
    await loginMe()
    await expect(api.health.put(TRIP, 'nobody', input())).rejects.toMatchObject({ status: 404 })
    await expect(api.health.remove(TRIP, 'nobody')).rejects.toMatchObject({ status: 404 })
  })

  it('지우면 바로 사라지고, 없는 기록을 지워도 조용히 끝난다. 지운 뒤에는 처음 넣기 규칙으로 돌아간다', async () => {
    await loginMe()
    await addGranny()
    await loginDad()
    await api.health.put(TRIP, 'tr-gran', input())
    await api.health.remove(TRIP, 'tr-gran')
    await expect(api.health.remove(TRIP, 'tr-gran')).resolves.toBeUndefined()
    expect(await api.health.list(TRIP)).toEqual([])

    await loginMe()
    const again = await api.health.put(TRIP, 'tr-gran', input({ conditions: ['gout'] }))
    expect(again.enteredByUserId).toBe('u-me')
  })

  it('계정 없는 분에 다른 가족이 자기 계정을 걸면 그 전 "본인만" 기록이 지워진다 (서버와 같다)', async () => {
    await loginMe()
    await addGranny()
    await loginDad()
    await api.health.put(TRIP, 'tr-gran', input({ visibility: 'self' }))
    expect(await listedIds()).toEqual(['tr-gran'])

    // 내가 할머니 칸에 내 계정을 건다 (화면의 "이 사람이 저예요"와 같은 저장)
    await loginMe()
    const detail = await api.trips.get(TRIP)
    const mine = detail.travelers.find(t => t.userId === 'u-me')
    const relinked = detail.travelers.map(t => {
      if (t.id === 'tr-gran') return { ...t, userId: 'u-me' }
      if (mine && t.id === mine.id) {
        const copy = { ...t }
        delete copy.userId
        return copy
      }
      return t
    })
    await api.trips.putTravelers(TRIP, relinked)

    expect(await api.health.list(TRIP)).toEqual([])
    await loginDad()
    expect(await api.health.list(TRIP)).toEqual([])
  })

  it('여행자 목록에서 빠진 사람의 건강 정보도 함께 사라진다', async () => {
    await loginMe()
    await addGranny()
    await api.health.put(TRIP, 'tr-gran', input())
    await api.health.put(TRIP, 'tr-me', input())
    expect(await listedIds()).toEqual(['tr-me', 'tr-gran'])

    const detail = await api.trips.get(TRIP)
    await api.trips.putTravelers(TRIP, detail.travelers.filter(t => t.id !== 'tr-gran'))
    expect(await listedIds()).toEqual(['tr-me'])

    // 같은 id 로 다시 넣어도 예전 기록이 되살아나지 않는다
    await addGranny()
    expect(await listedIds()).toEqual(['tr-me'])
  })

  // AI 가 여행자 목록을 통째로 바꾸는 길(인터뷰 마무리·일정 만들기)도 서버의 replaceTravelers 처럼 빠진 사람의 건강 정보를 지운다.
  // 인터뷰 상태를 직접 심어 두고 그 길을 부른다. 새 목록에는 tr-gran 이 없다.
  async function plantInterview(slot: 'done' | 'travelers') {
    const detail = await api.trips.get(TRIP)
    const kept = detail.travelers.filter(t => t.id !== 'tr-gran')
    getDb().interviews[TRIP] = {
      filled: { mode: 'scratch', travelers: kept, styles: [], mustVisit: [], fixTargets: [] },
      cursor: { slot, travelerIndex: 0, questionIndex: 0 },
      history: [],
    }
  }

  async function withGrannyHealth() {
    await loginMe()
    await addGranny()
    await api.health.put(TRIP, 'tr-gran', input())
    await api.health.put(TRIP, 'tr-me', input())
    expect(await listedIds()).toEqual(['tr-me', 'tr-gran'])
  }

  it('인터뷰를 마쳐 여행자 목록이 바뀌면 빠진 사람의 건강 정보도 사라진다', async () => {
    await withGrannyHealth()
    await plantInterview('done')

    expect((await api.ai.interview({ tripId: TRIP })).done).toBe(true)

    expect(await listedIds()).toEqual(['tr-me'])
    // 같은 id 로 다시 넣어도 예전 기록이 되살아나지 않는다
    await addGranny()
    expect(await listedIds()).toEqual(['tr-me'])
  })

  it('일정 만들기가 인터뷰의 여행자 목록으로 바꿔도 빠진 사람의 건강 정보가 사라진다', async () => {
    await withGrannyHealth()
    await plantInterview('travelers')

    await api.ai.generate({ tripId: TRIP })

    expect(await listedIds()).toEqual(['tr-me'])
    await addGranny()
    expect(await listedIds()).toEqual(['tr-me'])
  })

  it('여행이 달라도 같은 여행자 id 가 섞이지 않는다', async () => {
    // 목업 시드는 두 여행이 같은 id(tr-me …)를 쓴다
    await loginMe()
    await api.health.put(TRIP, 'tr-me', input())
    expect(await listedIds()).toEqual(['tr-me'])
    expect(await api.health.list('t-fall')).toEqual([])
  })

  it('에러 문구는 서버와 같은 정해진 문장이고 병·약 이름을 담지 않는다', async () => {
    await loginMom()
    await api.health.put(TRIP, 'tr-mom', input({ conditions: ['kidney_disease'], medicationClasses: ['warfarin'] }))
    await loginMe()

    const forbidden = await api.health.put(TRIP, 'tr-mom', input({ conditions: ['diabetes'] })).catch((e: unknown) => e)
    const notFound = await api.health.put(TRIP, 'nobody', input({ conditions: ['diabetes'] })).catch((e: unknown) => e)
    const invalid = await api.health.put(TRIP, 'tr-me', input({ conditions: ['diabetes'], consent: false })).catch((e: unknown) => e)
    expect(forbidden).toMatchObject({ status: 403, message: '이 건강 정보는 고칠 수 없어요' })
    expect(notFound).toMatchObject({ status: 404, message: '그 여행자를 찾을 수 없어요' })
    expect(invalid).toMatchObject({ status: 400, message: '요청 내용이 형식에 맞지 않아요' })
  })

  it('돌려준 값을 고쳐도 저장된 값은 바뀌지 않는다 (복사본이다)', async () => {
    await loginMe()
    const saved = await api.health.put(TRIP, 'tr-me', input({ visibility: 'self' }))
    saved.conditions.push('gout')
    const [stored] = await api.health.list(TRIP)
    expect(stored.conditions).toEqual(['diabetes'])
  })
})
