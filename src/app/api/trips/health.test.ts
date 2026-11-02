// 건강 정보 API 테스트. 가장 중요한 것: "본인만"이 다른 가족의 목록에 아예 없는 것, 남이 고치거나 지우지 못하는 것,
// 동의(consent: true) 없이는 저장되지 않는 것. 에러 응답과 로그에 병·약 이름이 새지 않는 것도 본다.
import { DrizzleQueryError } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema, HealthListResponseSchema, TravelerHealthSchema } from '@/lib/contracts'
import type { TravelerHealthInput } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  addMember,
  createGroup as insertGroup,
  insertTrip,
  jsonRequestWith,
  readBody,
  requestWith,
  routeParams,
  signUp,
  traveler,
} from '@/lib/auth/test-fixtures'
import { GET as getHealth } from './[id]/health/route'
import { DELETE as deleteHealth, PUT as putHealth } from './[id]/travelers/[tid]/health/route'
import { PUT as putTravelers } from './[id]/travelers/route'

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
  // 제한 시간 60초: PGlite 띄우기가 1.6초쯤 걸려 vitest 기본값으로는 모자랄 수 있다.
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

const input = (patch: Record<string, unknown> = {}): TravelerHealthInput => ({
  conditions: ['diabetes'],
  medicationClasses: [],
  visibility: 'group',
  consent: true,
  ...patch,
}) as TravelerHealthInput

const putRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'PUT', cookie, body, path: '/api/trips/x/travelers/y/health' })

const deleteRequest = (cookie: string | undefined) =>
  jsonRequestWith({ method: 'DELETE', cookie, path: '/api/trips/x/travelers/y/health' })

const savePut = (cookie: string | undefined, tripId: string, tid: string, body: unknown = input()) =>
  putHealth(putRequest(cookie, body), routeParams({ id: tripId, tid }))

const saveDelete = (cookie: string | undefined, tripId: string, tid: string) =>
  deleteHealth(deleteRequest(cookie), routeParams({ id: tripId, tid }))

const list = (cookie: string | undefined, tripId: string) => getHealth(requestWith(cookie), routeParams({ id: tripId }))

async function listed(cookie: string | undefined, tripId: string) {
  const response = await list(cookie, tripId)
  expect(response.status).toBe(200)
  return HealthListResponseSchema.parse(await readBody(response)).health
}

// 그룹장(나) · 엄마(계정 연결, t1) · 아들(구성원) · 할머니(계정 없음, t2) · 남(다른 그룹)
async function setup() {
  const owner = await signUp({ name: '김경선', email: 'owner@example.com' })
  const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
  const son = await signUp({ name: '아들', email: 'son@example.com' })
  const stranger = await signUp({ name: '남', email: 'stranger@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })
  await addMember(testDb.db, { groupId, userId: son.userId, role: 'member', relation: '아들' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })

  // 계정 연결은 본인만 걸 수 있다 → 엄마가 자기 칸(t1)에 연결해 저장한다
  const saved = await putTravelers(
    jsonRequestWith({
      method: 'PUT',
      cookie: mom.cookie,
      path: '/api/trips/x/travelers',
      body: {
        travelers: [
          traveler({ id: 't1', label: '엄마', userId: mom.userId, isParent: true }),
          traveler({ id: 't2', label: '할머니', isParent: true }),
        ],
      },
    }),
    routeParams({ id: tripId }),
  )
  expect(saved.status).toBe(200)
  return { owner, mom, son, stranger, groupId, tripId }
}

describe('GET /api/trips/:id/health (보는 사람 기준 목록)', () => {
  it('로그인 안 하면 401', async () => {
    const { tripId } = await setup()
    expect((await list(undefined, tripId)).status).toBe(401)
  })

  it('다른 그룹 사람은 403', async () => {
    const { tripId, stranger } = await setup()
    const response = await list(stranger.cookie, tripId)
    expect(response.status).toBe(403)
    ApiErrorSchema.parse(await readBody(response))
  })

  it('건강 정보가 없으면 빈 배열이다', async () => {
    const { tripId, owner } = await setup()
    expect(await listed(owner.cookie, tripId)).toEqual([])
  })

  it('가족 모두로 저장한 정보는 구성원 누구나 받는다', async () => {
    const { tripId, owner, mom, son } = await setup()
    await savePut(owner.cookie, tripId, 't2', input({ conditions: ['gout'], visibility: 'group' }))

    for (const member of [owner, mom, son]) {
      const health = await listed(member.cookie, tripId)
      expect(health).toHaveLength(1)
      expect(health[0]).toMatchObject({ tripId, travelerId: 't2', conditions: ['gout'], visibility: 'group' })
    }
  })

  it('본인만 + 계정 있는 엄마: 다른 가족 목록에는 항목 자체가 없고, 엄마 본인만 받는다', async () => {
    const { tripId, owner, mom, son } = await setup()
    await savePut(mom.cookie, tripId, 't1', input({ conditions: ['heart_disease'], visibility: 'self' }))

    expect(await listed(mom.cookie, tripId)).toHaveLength(1)
    // 응답 전체를 문자열로 봐도 엄마의 항목이 새지 않아야 한다 (항목이 비어서 오는 것도 새는 것이다)
    for (const other of [owner, son]) {
      const response = await list(other.cookie, tripId)
      const text = JSON.stringify(await readBody(response))
      expect(text).toBe('{"health":[]}')
    }
  })

  it('본인만 + 계정 없는 할머니: 대신 입력한 사람만 받는다', async () => {
    const { tripId, owner, mom, son } = await setup()
    await savePut(son.cookie, tripId, 't2', input({ conditions: ['kidney_disease'], visibility: 'self' }))

    expect(await listed(son.cookie, tripId)).toHaveLength(1)
    expect(await listed(owner.cookie, tripId)).toEqual([])
    expect(await listed(mom.cookie, tripId)).toEqual([])
  })

  it('보이는 항목과 안 보이는 항목이 섞여 있으면 보이는 것만 받는다', async () => {
    const { tripId, owner, mom, son } = await setup()
    await savePut(owner.cookie, tripId, 't2', input({ conditions: ['gout'], visibility: 'group' }))
    await savePut(mom.cookie, tripId, 't1', input({ conditions: ['heart_disease'], visibility: 'self' }))

    expect((await listed(son.cookie, tripId)).map(one => one.travelerId)).toEqual(['t2'])
    // 엄마는 둘 다 받는다 (여행자 순서대로)
    expect((await listed(mom.cookie, tripId)).map(one => one.travelerId)).toEqual(['t1', 't2'])
  })

  it('다른 여행의 건강 정보는 섞이지 않는다', async () => {
    const { tripId, groupId, owner } = await setup()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    await putTravelers(
      jsonRequestWith({
        method: 'PUT',
        cookie: owner.cookie,
        path: '/api/trips/x/travelers',
        body: { travelers: [traveler({ id: 't2', label: '할머니' })] },
      }),
      routeParams({ id: otherTripId }),
    )
    await savePut(owner.cookie, otherTripId, 't2', input({ conditions: ['gout'] }))

    expect(await listed(owner.cookie, tripId)).toEqual([])
    expect(await listed(owner.cookie, otherTripId)).toHaveLength(1)
  })
})

describe('PUT /api/trips/:id/travelers/:tid/health (저장)', () => {
  it('로그인 안 하면 401이고 저장되지 않는다', async () => {
    const { tripId, owner } = await setup()
    expect((await savePut(undefined, tripId, 't2')).status).toBe(401)
    expect(await listed(owner.cookie, tripId)).toEqual([])
  })

  it('다른 그룹 사람은 403이고 저장되지 않는다', async () => {
    const { tripId, owner, stranger } = await setup()
    expect((await savePut(stranger.cookie, tripId, 't2')).status).toBe(403)
    expect(await listed(owner.cookie, tripId)).toEqual([])
  })

  it('동의(consent: true)가 없으면 400이고 저장되지 않는다', async () => {
    const { tripId, owner } = await setup()
    const { consent: _consent, ...withoutConsent } = input()
    void _consent

    expect((await savePut(owner.cookie, tripId, 't2', withoutConsent)).status).toBe(400)
    expect((await savePut(owner.cookie, tripId, 't2', input({ consent: false }))).status).toBe(400)
    expect((await savePut(owner.cookie, tripId, 't2', input({ consent: 'true' }))).status).toBe(400)
    expect(await listed(owner.cookie, tripId)).toEqual([])
  })

  it('목록 밖 병·약, 보이는 범위가 잘못되면 400', async () => {
    const { tripId, owner } = await setup()
    expect((await savePut(owner.cookie, tripId, 't2', input({ conditions: ['cold'] }))).status).toBe(400)
    expect((await savePut(owner.cookie, tripId, 't2', input({ medicationClasses: ['antibiotic'] }))).status).toBe(400)
    expect((await savePut(owner.cookie, tripId, 't2', input({ visibility: 'public' }))).status).toBe(400)
    expect((await savePut(owner.cookie, tripId, 't2', 'not json object')).status).toBe(400)
  })

  it('몸체 없이 보내도 400', async () => {
    const { tripId, owner } = await setup()
    const response = await putHealth(
      jsonRequestWith({ method: 'PUT', cookie: owner.cookie, path: '/api/trips/x/travelers/t2/health' }),
      routeParams({ id: tripId, tid: 't2' }),
    )
    expect(response.status).toBe(400)
  })

  it('정상 저장: 계약 모양으로 돌려주고 서버가 동의 날짜와 입력자를 정한다', async () => {
    const { tripId, owner } = await setup()

    const before = Date.now()
    const response = await savePut(
      owner.cookie,
      tripId,
      't2',
      // 몸체로 보낸 입력자·동의 날짜는 믿지 않는다
      { ...input({ conditions: ['diabetes', 'gout'], medicationClasses: ['warfarin'] }), enteredByUserId: 'someone-else', consentAt: '2000-01-01T00:00:00.000Z' },
    )
    expect(response.status).toBe(200)

    const saved = TravelerHealthSchema.parse(await readBody(response))
    expect(saved).toMatchObject({
      tripId,
      travelerId: 't2',
      conditions: ['diabetes', 'gout'],
      medicationClasses: ['warfarin'],
      visibility: 'group',
      enteredByUserId: owner.userId,
    })
    expect(Date.parse(saved.consentAt)).toBeGreaterThanOrEqual(before)
    expect(await listed(owner.cookie, tripId)).toEqual([saved])
  })

  it('다시 저장하면 값이 바뀌고 첫 입력자는 그대로다', async () => {
    const { tripId, son } = await setup()
    await savePut(son.cookie, tripId, 't2', input({ conditions: ['diabetes'] }))

    const second = TravelerHealthSchema.parse(
      await readBody(await savePut(son.cookie, tripId, 't2', input({ conditions: ['hypertension'], visibility: 'self' }))),
    )
    expect(second).toMatchObject({ conditions: ['hypertension'], visibility: 'self', enteredByUserId: son.userId })
    expect(await listed(son.cookie, tripId)).toHaveLength(1)
  })

  it('없는 여행자는 404', async () => {
    const { tripId, owner } = await setup()
    expect((await savePut(owner.cookie, tripId, 'nobody')).status).toBe(404)
  })

  it('남의 계정이 연결된 엄마(t1)는 아들·그룹장이 넣을 수 없다 (403), 엄마 본인은 된다', async () => {
    const { tripId, owner, mom, son } = await setup()

    expect((await savePut(son.cookie, tripId, 't1')).status).toBe(403)
    expect((await savePut(owner.cookie, tripId, 't1')).status).toBe(403)
    expect(await listed(mom.cookie, tripId)).toEqual([])

    expect((await savePut(mom.cookie, tripId, 't1')).status).toBe(200)
    expect(await listed(mom.cookie, tripId)).toHaveLength(1)
  })

  it('엄마가 저장한 정보를 아들이 PUT으로 덮어쓰려 하면 403이고 값이 그대로다', async () => {
    const { tripId, mom, son } = await setup()
    await savePut(mom.cookie, tripId, 't1', input({ conditions: ['hypertension'], visibility: 'group' }))

    expect((await savePut(son.cookie, tripId, 't1', input({ conditions: ['gout'] }))).status).toBe(403)
    expect((await listed(son.cookie, tripId))[0].conditions).toEqual(['hypertension'])
  })

  it('계정 없는 할머니(t2)는 처음 넣은 사람만 고친다. 처음 넣기는 구성원 누구나 할 수 있다', async () => {
    const { tripId, owner, son } = await setup()

    expect((await savePut(son.cookie, tripId, 't2')).status).toBe(200) // 처음 넣기
    expect((await savePut(owner.cookie, tripId, 't2', input({ conditions: ['gout'] }))).status).toBe(403)
    expect((await savePut(son.cookie, tripId, 't2', input({ conditions: ['gout'] }))).status).toBe(200)
  })

  it('403·400·404 응답 메시지는 정해진 문장이고 병·약 이름을 담지 않는다', async () => {
    const { tripId, son, owner } = await setup()
    await savePut(son.cookie, tripId, 't2', input({ conditions: ['gout'], medicationClasses: ['warfarin'] }))

    const forbidden = await savePut(owner.cookie, tripId, 't2', input({ conditions: ['diabetes'], medicationClasses: ['warfarin'] }))
    const notFound = await savePut(owner.cookie, tripId, 'nobody', input({ conditions: ['diabetes'] }))
    const invalid = await savePut(owner.cookie, tripId, 't2', input({ conditions: ['diabetes'], consent: false }))

    expect(forbidden.status).toBe(403)
    expect(notFound.status).toBe(404)
    expect(invalid.status).toBe(400)
    expect(ApiErrorSchema.parse(await readBody(forbidden)).error.message).toBe('이 건강 정보는 고칠 수 없어요')
    expect(ApiErrorSchema.parse(await readBody(notFound)).error.message).toBe('그 여행자를 찾을 수 없어요')
    expect(ApiErrorSchema.parse(await readBody(invalid)).error.message).toBe('요청 내용이 형식에 맞지 않아요')
  })

  it('저장·조회·삭제 과정에서 병·약 이름을 로그에 남기지 않는다', async () => {
    const logs: string[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
      })
    }
    const { tripId, owner, son } = await setup()
    logs.length = 0 // 준비 과정(가입 등)의 로그는 제외한다

    await savePut(owner.cookie, tripId, 't2', input({ conditions: ['kidney_disease'], medicationClasses: ['warfarin'], visibility: 'self' }))
    await savePut(son.cookie, tripId, 't2', input({ conditions: ['kidney_disease'] })) // 403 경로
    await list(son.cookie, tripId)
    await list(owner.cookie, tripId)
    await saveDelete(owner.cookie, tripId, 't2')

    const joined = logs.join('\n')
    for (const secret of ['kidney_disease', 'warfarin', '신장', '와파린', 'diabetes']) expect(joined).not.toContain(secret)
  })
})

// 로그에 찍힐 수 있는 모든 글자: 이름·메시지·스택에 cause까지 따라가며 모은다
function everythingIn(value: unknown, depth = 0): string {
  if (depth > 5) return ''
  if (value instanceof Error) {
    return [value.name, value.message, value.stack ?? '', everythingIn(value.cause, depth + 1)].join('\n')
  }
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
}

describe('PUT 저장 중 DB 오류 (로그에 건강 값이 남지 않는다)', () => {
  it('쿼리가 실패해 메시지에 SQL 인자가 담겨도 500이고, 어떤 로그에도 병·약 값이 없다', async () => {
    const logged: unknown[][] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args)
      })
    }
    const { tripId, owner } = await setup()
    logged.length = 0 // 준비 과정의 로그는 제외한다

    // drizzle은 실패한 쿼리를 "Failed query: … params: …"로 감싸 인자(병·약 값)를 메시지에 담고 원래 오류를 cause로 붙인다
    const failure = new DrizzleQueryError(
      'insert into "trip_traveler_health" ("trip_id", "traveler_id", "conditions", "medication_classes") values ($1, $2, $3, $4)',
      [tripId, 't2', ['diabetes'], ['warfarin']],
      new Error('connection terminated while writing warfarin'),
    )
    const chain = { values: () => chain, onConflictDoUpdate: () => chain, returning: () => Promise.reject(failure) }
    vi.spyOn(testDb.db, 'insert').mockReturnValue(chain as never)

    const response = await savePut(owner.cookie, tripId, 't2', input({ conditions: ['diabetes'], medicationClasses: ['warfarin'] }))

    expect(response.status).toBe(500)
    expect(JSON.stringify(await readBody(response))).not.toContain('warfarin')
    // 로그가 아예 없으면 이 검사가 아무것도 보지 못한 것이다 — 서버 오류는 한 줄 남아야 한다
    expect(logged.length).toBeGreaterThan(0)
    const everything = logged.flat().map(arg => everythingIn(arg)).join('\n')
    for (const secret of ['warfarin', 'diabetes', '와파린', '당뇨']) expect(everything).not.toContain(secret)
  })

  it('DB 오류가 아닌 권한·검사 실패(HttpError)는 그대로 403·400으로 나간다', async () => {
    const { tripId, son, owner } = await setup()
    await savePut(son.cookie, tripId, 't2')

    expect((await savePut(owner.cookie, tripId, 't2')).status).toBe(403)
    expect((await savePut(owner.cookie, tripId, 't2', input({ consent: false }))).status).toBe(400)
  })
})

describe('DELETE /api/trips/:id/travelers/:tid/health (지우기 = 동의 철회)', () => {
  it('로그인 안 하면 401이고 지워지지 않는다', async () => {
    const { tripId, owner } = await setup()
    await savePut(owner.cookie, tripId, 't2')

    expect((await saveDelete(undefined, tripId, 't2')).status).toBe(401)
    expect(await listed(owner.cookie, tripId)).toHaveLength(1)
  })

  it('다른 그룹 사람은 403이고 지워지지 않는다', async () => {
    const { tripId, owner, stranger } = await setup()
    await savePut(owner.cookie, tripId, 't2')

    expect((await saveDelete(stranger.cookie, tripId, 't2')).status).toBe(403)
    expect(await listed(owner.cookie, tripId)).toHaveLength(1)
  })

  it('정상 삭제: 204에 본문이 없고, 바로 목록에서 사라진다', async () => {
    const { tripId, owner, son } = await setup()
    await savePut(owner.cookie, tripId, 't2')

    const response = await saveDelete(owner.cookie, tripId, 't2')
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(await listed(owner.cookie, tripId)).toEqual([])
    expect(await listed(son.cookie, tripId)).toEqual([])
  })

  it('없는 기록을 지워도 204로 조용히 끝난다', async () => {
    const { tripId, owner } = await setup()
    expect((await saveDelete(owner.cookie, tripId, 't2')).status).toBe(204)
  })

  it('없는 여행자는 404', async () => {
    const { tripId, owner } = await setup()
    expect((await saveDelete(owner.cookie, tripId, 'nobody')).status).toBe(404)
  })

  it('엄마(t1)의 건강 정보는 아들·그룹장이 지울 수 없다 (403), 엄마 본인은 지운다', async () => {
    const { tripId, owner, mom, son } = await setup()
    await savePut(mom.cookie, tripId, 't1', input({ visibility: 'group' }))

    expect((await saveDelete(son.cookie, tripId, 't1')).status).toBe(403)
    expect((await saveDelete(owner.cookie, tripId, 't1')).status).toBe(403)
    expect(await listed(son.cookie, tripId)).toHaveLength(1)

    expect((await saveDelete(mom.cookie, tripId, 't1')).status).toBe(204)
    expect(await listed(son.cookie, tripId)).toEqual([])
  })

  it('계정 없는 할머니(t2)는 처음 넣은 사람만 지운다', async () => {
    const { tripId, owner, son } = await setup()
    await savePut(son.cookie, tripId, 't2')

    expect((await saveDelete(owner.cookie, tripId, 't2')).status).toBe(403)
    expect(await listed(son.cookie, tripId)).toHaveLength(1)
    expect((await saveDelete(son.cookie, tripId, 't2')).status).toBe(204)
  })

  it('지운 뒤에는 처음 넣기 규칙으로 돌아가 다른 구성원이 새로 넣을 수 있다', async () => {
    const { tripId, owner, son } = await setup()
    await savePut(son.cookie, tripId, 't2')
    await saveDelete(son.cookie, tripId, 't2')

    expect((await savePut(owner.cookie, tripId, 't2', input({ conditions: ['gout'] }))).status).toBe(200)
    expect((await listed(owner.cookie, tripId))[0]).toMatchObject({ conditions: ['gout'], enteredByUserId: owner.userId })
  })
})

describe('여행자 목록과의 연결', () => {
  it('여행자 목록을 저장할 때 빠진 사람의 건강 정보는 목록에서 사라진다', async () => {
    const { tripId, owner, mom } = await setup()
    await savePut(owner.cookie, tripId, 't2')
    expect(await listed(owner.cookie, tripId)).toHaveLength(1)

    await putTravelers(
      jsonRequestWith({
        method: 'PUT',
        cookie: mom.cookie,
        path: '/api/trips/x/travelers',
        body: { travelers: [traveler({ id: 't1', label: '엄마', userId: mom.userId, isParent: true })] },
      }),
      routeParams({ id: tripId }),
    )

    expect(await listed(owner.cookie, tripId)).toEqual([])
  })

  // 연결은 그룹 구성원 누구나 "이 사람이 저예요"로 걸 수 있고 서버는 정말 본인인지 모른다.
  // 기록을 남겨 두면 남이 연결만 걸어 "본인만" 정보를 보고, 대신 입력한 사람은 지우지도 못한다 → 연결이 바뀌면 지운다.
  const putTravelersAs = (cookie: string, tripId: string, travelers: ReturnType<typeof traveler>[]) =>
    putTravelers(
      jsonRequestWith({ method: 'PUT', cookie, path: '/api/trips/x/travelers', body: { travelers } }),
      routeParams({ id: tripId }),
    )

  it('계정 없는 분에 다른 가족이 자기 계정을 걸면, 그 전 "본인만" 기록은 지워져 아무도 받지 못한다', async () => {
    const { tripId, owner, mom, son } = await setup()
    expect((await savePut(son.cookie, tripId, 't2', input({ conditions: ['diabetes'], medicationClasses: ['warfarin'], visibility: 'self' }))).status).toBe(200)
    expect(await listed(owner.cookie, tripId)).toEqual([])

    // 그룹장이 할머니(t2)에 자기 계정을 건다
    const relinked = await putTravelersAs(owner.cookie, tripId, [
      traveler({ id: 't1', label: '엄마', userId: mom.userId, isParent: true }),
      traveler({ id: 't2', label: '할머니', userId: owner.userId, isParent: true }),
    ])
    expect(relinked.status).toBe(200)

    expect(await listed(owner.cookie, tripId)).toEqual([])
    expect(await listed(son.cookie, tripId)).toEqual([])
    // 기록 자체가 없으니 지우기(동의 철회)도 조용히 끝난다 — 아들에게는 연결된 남의 칸이라 403이다
    expect((await saveDelete(son.cookie, tripId, 't2')).status).toBe(403)
  })

  it('연결을 풀어도 그 사람의 기록은 지워진다 (대신 입력한 사람이 다시 보게 되지 않게)', async () => {
    const { tripId, mom, son } = await setup()
    expect((await savePut(mom.cookie, tripId, 't1', input({ visibility: 'self' }))).status).toBe(200)
    expect(await listed(mom.cookie, tripId)).toHaveLength(1)

    const released = await putTravelersAs(mom.cookie, tripId, [
      traveler({ id: 't1', label: '엄마', isParent: true }),
      traveler({ id: 't2', label: '할머니', isParent: true }),
    ])
    expect(released.status).toBe(200)

    expect(await listed(mom.cookie, tripId)).toEqual([])
    expect(await listed(son.cookie, tripId)).toEqual([])
  })

  it('연결이 그대로면 여행자 목록을 다시 저장해도 기록은 남는다', async () => {
    const { tripId, mom, son } = await setup()
    await savePut(mom.cookie, tripId, 't1', input({ visibility: 'group' }))
    await savePut(son.cookie, tripId, 't2', input({ visibility: 'group' }))

    const again = await putTravelersAs(son.cookie, tripId, [
      traveler({ id: 't1', label: '엄마', userId: mom.userId, isParent: true }),
      traveler({ id: 't2', label: '할머니 (이름 바꿈)', isParent: true }),
    ])
    expect(again.status).toBe(200)

    expect((await listed(son.cookie, tripId)).map(h => h.travelerId)).toEqual(['t1', 't2'])
  })
})
