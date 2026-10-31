import { beforeEach, describe, expect, it } from 'vitest'
import { isApiError } from '@/lib/api-client/http'
import type { Traveler } from '@/lib/contracts'
import { mockApi as api } from './mock-api'
import { DEMO_EMAIL, DEMO_PASSWORD } from './seed'
import { resetMockDb } from './store'

// 목업 PUT /api/trips/:id/travelers 가 서버(src/lib/trips/travelers.ts)와 같은 규칙을 따르는지.
// 로그인하는 사람은 u-me(오하연). 't-daejeon' 의 여행자: tr-mom(u-mom 연결, 본인 입력), tr-dad(u-dad 연결, 본인 입력 아님), tr-me(u-me 연결, 본인 입력)
const TRIP = 't-daejeon'

const blank = (id: string, extra: Partial<Traveler> = {}): Traveler => ({
  id, label: id, pace: 'unknown', mobilityAid: false, isParent: false, condition: {}, filledBySelf: false, ...extra,
})

async function loginDemo() {
  await api.auth.signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
}

async function currentTravelers(): Promise<Traveler[]> {
  return (await api.trips.get(TRIP)).travelers
}

async function putError(travelers: Traveler[]) {
  const error = await api.trips.putTravelers(TRIP, travelers).catch((e: unknown) => e)
  if (!isApiError(error)) throw new Error('오류가 나야 하는 요청이 성공했어요')
  return error
}

const byId = (list: Traveler[]): Record<string, Traveler> => Object.fromEntries(list.map(one => [one.id, one]))

describe('목업 여행자 저장 (서버 규칙)', () => {
  beforeEach(() => resetMockDb())

  it('남의 계정을 새로 거는 요청은 400', async () => {
    await loginDemo()
    const current = await currentTravelers()
    for (const userId of ['u-stranger', 'u-dad']) {
      const error = await putError([...current, blank('tr-new', { userId })])
      expect(error.status).toBe(400)
      expect(error.message).toBe('내 계정만 연결할 수 있어요')
    }
  })

  it('남의 연결은 풀지 않고 그대로 둔다 (빼서 보내도, 다른 계정으로 바꿔 보내도)', async () => {
    await loginDemo()
    const current = await currentTravelers()
    const sent = current.map(one => (one.id === 'tr-mom' ? { ...one, userId: undefined } : one.id === 'tr-dad' ? { ...one, userId: 'u-me' } : one))
    const saved = byId(await api.trips.putTravelers(TRIP, sent))
    expect(saved['tr-mom'].userId).toBe('u-mom')
    expect(saved['tr-dad'].userId).toBe('u-dad')
    expect(saved['tr-me'].userId).toBe('u-me')
  })

  it('내 연결은 풀 수 있다', async () => {
    await loginDemo()
    const current = await currentTravelers()
    const saved = byId(await api.trips.putTravelers(TRIP, current.map(one => (one.id === 'tr-me' ? { ...one, userId: undefined } : one))))
    expect('userId' in saved['tr-me']).toBe(false)
    expect(saved['tr-mom'].userId).toBe('u-mom')
  })

  it('한 계정은 한 사람과만 연결된다', async () => {
    await loginDemo()
    const current = await currentTravelers()
    // u-me 는 이미 tr-me 와 연결돼 있다
    const error = await putError([...current, blank('tr-new', { userId: 'u-me' })])
    expect(error.status).toBe(400)
    expect(error.message).toBe('한 계정은 한 사람과만 연결할 수 있어요')
  })

  it('같은 id 의 여행자가 둘 이상이면 400', async () => {
    await loginDemo()
    const current = await currentTravelers()
    const error = await putError([...current, blank('tr-me')])
    expect(error.status).toBe(400)
    expect(error.message).toBe('같은 id의 여행자가 둘 이상이에요')
  })

  it('filledBySelf 는 화면이 보낸 값을 믿지 않고 직접 계산한다', async () => {
    await loginDemo()
    const current = await currentTravelers()
    const sent = [
      ...current.map(one => (one.id === 'tr-dad' ? { ...one, age: 71, filledBySelf: true } : one.id === 'tr-mom' ? { ...one, filledBySelf: false } : one)),
      blank('tr-new', { filledBySelf: true }),
    ]
    const saved = byId(await api.trips.putTravelers(TRIP, sent))
    expect(saved['tr-dad'].age).toBe(71)
    expect(saved['tr-dad'].filledBySelf).toBe(false) // 아빠 계정은 내 것이 아니라, 내가 고쳐도 아빠의 본인 입력이 아니다
    expect(saved['tr-mom'].filledBySelf).toBe(true) // 한 번 true 면 계속 true
    expect(saved['tr-new'].filledBySelf).toBe(false) // 계정 연결이 없는 새 사람
  })

  it('내 계정을 새로 연결해도 걷기 조건이 그대로면 본인 입력이 아니고, 조건을 고치면 본인 입력이 된다', async () => {
    await loginDemo()
    const current = await currentTravelers()
    const freed = current.map(one => (one.id === 'tr-me' ? { ...one, userId: undefined } : one)) // 내 연결을 tr-me 에서 푼다
    await api.trips.putTravelers(TRIP, [...freed, blank('tr-x')])
    const linked = await api.trips.putTravelers(TRIP, [...freed, blank('tr-x', { userId: 'u-me' })])
    expect(byId(linked)['tr-x']).toMatchObject({ userId: 'u-me', filledBySelf: false })
    const edited = await api.trips.putTravelers(TRIP, linked.map(one => (one.id === 'tr-x' ? { ...one, age: 60 } : one)))
    expect(byId(edited)['tr-x'].filledBySelf).toBe(true)
  })

  it('내 계정이 연결된 새 사람은 만들 때부터 본인 입력이다', async () => {
    await loginDemo()
    const current = await currentTravelers()
    const freed = current.map(one => (one.id === 'tr-me' ? { ...one, userId: undefined } : one))
    const saved = byId(await api.trips.putTravelers(TRIP, [...freed, blank('tr-new', { userId: 'u-me' })]))
    expect(saved['tr-new']).toMatchObject({ userId: 'u-me', filledBySelf: true })
  })
})
