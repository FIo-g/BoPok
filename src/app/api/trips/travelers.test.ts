// 여행자 API 테스트. '본인이 직접 채웠는지(filledBySelf)'를 서버가 정하는 규칙(역할 문서)과
// 통째로 저장할 때 순서가 지켜지는지를 고정한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema, TravelerSchema } from '@/lib/contracts'
import type { Traveler } from '@/lib/contracts'
import { z } from 'zod'
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
import { GET as getTrip } from './[id]/route'
import { PUT as putTravelers } from './[id]/travelers/route'
import { PATCH as patchTraveler } from './[id]/travelers/[tid]/route'

const TravelerListSchema = z.array(TravelerSchema)

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

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

const putRequest = (cookie: string | undefined, travelers: Traveler[]) =>
  jsonRequestWith({ method: 'PUT', cookie, body: { travelers }, path: '/api/trips/x/travelers' })

const patchRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'PATCH', cookie, body, path: '/api/trips/x/travelers/y' })

// 그룹장 + 그룹 + 여행을 준비한다
async function tripWithOwner() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  return { owner, groupId, tripId }
}

describe('PUT /api/trips/:id/travelers (통째로 저장)', () => {
  it('받은 순서 그대로 저장하고 Traveler 배열로 돌려준다', async () => {
    const { owner, tripId } = await tripWithOwner()
    const sent = [
      traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female', pace: 'slow' }),
      traveler({ id: 't2', label: '아빠', isParent: true, age: 71 }),
      traveler({ id: 't3', label: '나' }),
    ]

    const response = await putTravelers(putRequest(owner.cookie, sent), routeParams({ id: tripId }))
    expect(response.status).toBe(200)

    // 화면이 쓰는 스키마로 검사한다
    const saved = TravelerListSchema.parse(await readBody(response))
    expect(saved.map(one => one.label)).toEqual(['엄마', '아빠', '나'])
    expect(saved[0]).toMatchObject({ id: 't1', isParent: true, age: 68, heightCm: 158, sex: 'female', pace: 'slow' })
    // 안 보낸 칸은 null이 아니라 '없음'으로 나간다 (계약이 optional이라 null이면 화면 검사에서 걸린다)
    expect(saved[2].age).toBeUndefined()
    expect(saved[2].userId).toBeUndefined()
  })

  it('다시 저장하면 이전 목록이 남지 않는다', async () => {
    const { owner, tripId } = await tripWithOwner()
    await putTravelers(putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마' })]), routeParams({ id: tripId }))

    const saved = TravelerListSchema.parse(
      await readBody(
        await putTravelers(putRequest(owner.cookie, [traveler({ id: 't9', label: '할머니' })]), routeParams({ id: tripId })),
      ),
    )
    expect(saved).toHaveLength(1)
    expect(saved[0].label).toBe('할머니')
  })

  it('조회에서도 같은 순서로 나온다', async () => {
    const { owner, tripId } = await tripWithOwner()
    await putTravelers(
      putRequest(owner.cookie, [
        traveler({ id: 't1', label: '엄마' }),
        traveler({ id: 't2', label: '아빠' }),
        traveler({ id: 't3', label: '나' }),
      ]),
      routeParams({ id: tripId }),
    )

    const detail = (await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId })))) as {
      travelers: Traveler[]
    }
    expect(detail.travelers.map(one => one.label)).toEqual(['엄마', '아빠', '나'])
  })

  it('걷기 조건은 일부만 채워도 그대로 저장된다', async () => {
    const { owner, tripId } = await tripWithOwner()
    const saved = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [
            traveler({ id: 't1', label: '엄마', condition: { continuousMin: 20, avoidStairs: true } }),
          ]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(saved[0].condition).toEqual({ continuousMin: 20, avoidStairs: true })
  })

  it('내 계정과 연결된 여행자는 filledBySelf가 true가 된다 (서버가 정한다)', async () => {
    const { owner, tripId } = await tripWithOwner()
    const saved = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [
            // 보낸 값은 false인데, 내 계정과 연결돼 있으니 서버가 true로 정한다
            traveler({ id: 't1', label: '나', userId: owner.userId, filledBySelf: false }),
            traveler({ id: 't2', label: '엄마', filledBySelf: false }),
          ]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(saved[0].filledBySelf).toBe(true)
    expect(saved[1].filledBySelf).toBe(false)
  })

  it('filledBySelf: true를 보내도 본인이 아니면 false로 저장된다', async () => {
    const { owner, tripId } = await tripWithOwner()
    const saved = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [
            // 몸체는 믿지 않는다 — 부모님이 직접 답한 것처럼 꾸밀 수 없게
            traveler({ id: 't1', label: '엄마', isParent: true, filledBySelf: true }),
          ]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(saved[0].filledBySelf).toBe(false)
  })

  it('본인이 PUT으로 자기 정보를 다시 저장하면 filledBySelf가 true가 된다', async () => {
    const { owner, groupId, tripId } = await tripWithOwner()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    // 자녀가 먼저 엄마 칸을 만든다 (계정 연결 없이) → 아직 '엄마가 직접 답한' 것이 아니다
    const first = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마', isParent: true })]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(first[0].filledBySelf).toBe(false)
    expect(first[0].userId).toBeUndefined()

    // 엄마가 '이 사람이 저예요'로 연결하고 자기 조건을 고쳐 저장한다 (화면은 PUT만 쓴다) → true
    const mine = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(mom.cookie, [
            traveler({ id: 't1', label: '엄마', userId: mom.userId, isParent: true, pace: 'slow' }),
          ]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(mine[0].filledBySelf).toBe(true)
    expect(mine[0].pace).toBe('slow')
    expect(mine[0].userId).toBe(mom.userId)
  })

  it('자녀가 PUT으로 다시 저장해도 부모님의 기존 true는 그대로 유지된다', async () => {
    const { owner, groupId, tripId } = await tripWithOwner()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    // 엄마가 자기 칸을 직접 채운다 → true
    await putTravelers(
      putRequest(mom.cookie, [traveler({ id: 't1', label: '엄마', userId: mom.userId })]),
      routeParams({ id: tripId }),
    )

    // 자녀가 목록을 다시 저장해도 '엄마가 직접 답했다'는 사실은 남는다
    const saved = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [
            traveler({ id: 't1', label: '엄마', userId: mom.userId, filledBySelf: false }),
            traveler({ id: 't2', label: '나', userId: owner.userId }),
          ]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(saved[0].filledBySelf).toBe(true) // 본인이 채운 사실은 남는다
    expect(saved[1].filledBySelf).toBe(true) // 새로 들어온 본인은 true
  })

  it('그룹 밖 사람의 userId로 저장하려 하면 400', async () => {
    const { owner, tripId } = await tripWithOwner()
    const outsider = await signUp({ name: '남', email: 'outsider@example.com' })

    const response = await putTravelers(
      putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마', userId: outsider.userId })]),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(400)

    // 아무것도 저장되지 않았다
    const detail = (await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId })))) as {
      travelers: Traveler[]
    }
    expect(detail.travelers).toEqual([])
  })

  it('한 계정을 두 사람에게 연결하면 400', async () => {
    const { owner, tripId } = await tripWithOwner()

    const response = await putTravelers(
      putRequest(owner.cookie, [
        traveler({ id: 't1', label: '나', userId: owner.userId }),
        traveler({ id: 't2', label: '나(둘)', userId: owner.userId }),
      ]),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(400)
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('한 계정은 한 사람과만 연결할 수 있어요')
  })

  it('남의 계정을 새로 연결하려 하면 400 (내 연결만 걸 수 있다)', async () => {
    const { owner, groupId, tripId } = await tripWithOwner()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    // 엄마는 같은 그룹 구성원이지만, 연결은 엄마 본인만 걸 수 있다
    const response = await putTravelers(
      putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마', userId: mom.userId })]),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(400)
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('내 계정만 연결할 수 있어요')
  })

  it('남의 연결은 몸체에서 빼거나 바꿔도 그대로 유지된다', async () => {
    const { owner, groupId, tripId } = await tripWithOwner()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    // 엄마가 자기 칸에 연결한다
    await putTravelers(
      putRequest(mom.cookie, [traveler({ id: 't1', label: '엄마', userId: mom.userId })]),
      routeParams({ id: tripId }),
    )

    // 자녀가 연결을 빼고 저장해도 엄마 연결은 남는다
    const released = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마' })]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(released[0].userId).toBe(mom.userId)

    // 자녀가 자기 계정으로 바꿔 보려 해도 엄마 연결이 그대로 남는다
    // (400이 아니라 '기존 값 유지'다 — 화면이 남의 연결을 건드릴 수 없게 막혀 있어 오류로 볼 일이 아니다)
    const stolen = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마', userId: owner.userId })]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(stolen[0].userId).toBe(mom.userId)
  })

  it('내 연결은 내가 풀 수 있다', async () => {
    const { owner, tripId } = await tripWithOwner()
    await putTravelers(
      putRequest(owner.cookie, [traveler({ id: 't1', label: '나', userId: owner.userId })]),
      routeParams({ id: tripId }),
    )

    const released = TravelerListSchema.parse(
      await readBody(
        await putTravelers(putRequest(owner.cookie, [traveler({ id: 't1', label: '나' })]), routeParams({ id: tripId })),
      ),
    )
    expect(released[0].userId).toBeUndefined()
  })

  it('연결만 하고 조건이 그대로면 filledBySelf는 올라가지 않는다', async () => {
    const { owner, groupId, tripId } = await tripWithOwner()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    // 자녀가 엄마 조건을 미리 적어 둔다 (조건 칸이 두 개 이상이어야 키 순서 문제까지 걸린다)
    const mine = traveler({
      id: 't1',
      label: '엄마',
      isParent: true,
      age: 68,
      heightCm: 158,
      sex: 'female',
      pace: 'slow',
      condition: { continuousMin: 20, avoidStairs: true, restMin: 10 },
    })
    await putTravelers(putRequest(owner.cookie, [mine]), routeParams({ id: tripId }))

    // 엄마가 연결만 하고 조건은 그대로 저장한다 → '직접 답했다'고 볼 수 없다
    const claimed = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(mom.cookie, [{ ...mine, userId: mom.userId }]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(claimed[0].userId).toBe(mom.userId)
    expect(claimed[0].filledBySelf).toBe(false)

    // 조건 한 칸을 실제로 바꾸면 true가 된다
    const answered = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(mom.cookie, [{ ...mine, userId: mom.userId, condition: { ...mine.condition, continuousMin: 15 } }]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(answered[0].filledBySelf).toBe(true)
  })

  it('이름표만 바꾸면 filledBySelf는 올라가지 않는다 (조건 칸이 아니다)', async () => {
    const { owner, tripId } = await tripWithOwner()
    await putTravelers(
      putRequest(owner.cookie, [traveler({ id: 't1', label: '엄마', age: 68 })]),
      routeParams({ id: tripId }),
    )

    const renamed = TravelerListSchema.parse(
      await readBody(
        await putTravelers(
          putRequest(owner.cookie, [traveler({ id: 't1', label: '어머니', age: 68, userId: owner.userId })]),
          routeParams({ id: tripId }),
        ),
      ),
    )
    expect(renamed[0].filledBySelf).toBe(false)
  })

  it('빈 목록은 400 (적어도 한 명은 있어야 한다)', async () => {
    const { owner, tripId } = await tripWithOwner()
    expect((await putTravelers(putRequest(owner.cookie, []), routeParams({ id: tripId }))).status).toBe(400)
  })

  it('나이·키가 범위를 벗어나면 400', async () => {
    const { owner, tripId } = await tripWithOwner()
    const tooOld = [traveler({ id: 't1', label: '엄마', age: 130 })]
    const tooShort = [traveler({ id: 't1', label: '엄마', heightCm: 30 })]
    expect((await putTravelers(putRequest(owner.cookie, tooOld), routeParams({ id: tripId }))).status).toBe(400)
    expect((await putTravelers(putRequest(owner.cookie, tooShort), routeParams({ id: tripId }))).status).toBe(400)
  })

  it('다른 그룹 사람은 403이고 여행자가 저장되지 않는다', async () => {
    const { owner, tripId } = await tripWithOwner()
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await putTravelers(
      putRequest(stranger.cookie, [traveler({ id: 't1', label: '남이 넣은 사람' })]),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(403)

    const detail = (await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId })))) as {
      travelers: Traveler[]
    }
    expect(detail.travelers).toEqual([])
  })

  it('로그인 안 하면 401', async () => {
    const { tripId } = await tripWithOwner()
    const response = await putTravelers(
      putRequest(undefined, [traveler({ id: 't1', label: '엄마' })]),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/trips/:id/travelers/:tid (한 사람 고치기)', () => {
  async function tripWithMom() {
    const base = await tripWithOwner()
    await putTravelers(
      putRequest(base.owner.cookie, [
        traveler({ id: 't1', label: '엄마', isParent: true, age: 68 }),
        traveler({ id: 't2', label: '나', userId: base.owner.userId }),
      ]),
      routeParams({ id: base.tripId }),
    )
    return base
  }

  it('보낸 칸만 바뀐다', async () => {
    const { owner, tripId } = await tripWithMom()

    const updated = TravelerSchema.parse(
      await readBody(
        await patchTraveler(
          patchRequest(owner.cookie, { pace: 'slow', condition: { continuousMin: 15, restMin: 10 } }),
          routeParams({ id: tripId, tid: 't1' }),
        ),
      ),
    )
    expect(updated).toMatchObject({ id: 't1', label: '엄마', age: 68, pace: 'slow', isParent: true })
    expect(updated.condition).toEqual({ continuousMin: 15, restMin: 10 })
  })

  it('본인 계정과 연결된 여행자를 고치면 filledBySelf가 true가 된다', async () => {
    const { owner, tripId } = await tripWithMom()

    const me = TravelerSchema.parse(
      await readBody(
        await patchTraveler(patchRequest(owner.cookie, { pace: 'normal' }), routeParams({ id: tripId, tid: 't2' })),
      ),
    )
    expect(me.filledBySelf).toBe(true)
  })

  it('계정이 연결 안 된 여행자를 고치면 filledBySelf는 false다', async () => {
    const { owner, tripId } = await tripWithMom()

    const mom = TravelerSchema.parse(
      await readBody(
        await patchTraveler(patchRequest(owner.cookie, { pace: 'slow' }), routeParams({ id: tripId, tid: 't1' })),
      ),
    )
    expect(mom.filledBySelf).toBe(false)
  })

  it('다른 구성원이 내 여행자를 고치면 filledBySelf가 올라가지 않는다', async () => {
    const { groupId, tripId } = await tripWithMom()
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    // t2는 owner의 계정과 연결된 여행자다. 아들이 고쳐도 '본인이 채운 것'이 아니다
    const patched = TravelerSchema.parse(
      await readBody(
        await patchTraveler(patchRequest(son.cookie, { pace: 'slow' }), routeParams({ id: tripId, tid: 't2' })),
      ),
    )
    expect(patched.filledBySelf).toBe(false)
  })

  it('나이를 null로 보내면 400 — 계약이 null을 받지 않는다 (비우려면 PUT으로 목록을 다시 저장)', async () => {
    const { owner, tripId } = await tripWithMom()
    const response = await patchTraveler(
      patchRequest(owner.cookie, { age: null }),
      routeParams({ id: tripId, tid: 't1' }),
    )
    expect(response.status).toBe(400)
  })

  it('자녀가 filledBySelf: true를 보내도 false로 저장된다', async () => {
    const { owner, tripId } = await tripWithMom()

    const mom = TravelerSchema.parse(
      await readBody(
        await patchTraveler(
          // 엄마는 계정이 연결돼 있지 않다 — 자녀가 '엄마가 직접 답했다'고 꾸밀 수 없어야 한다
          patchRequest(owner.cookie, { pace: 'slow', filledBySelf: true }),
          routeParams({ id: tripId, tid: 't1' }),
        ),
      ),
    )
    expect(mom.filledBySelf).toBe(false)
    expect(mom.pace).toBe('slow') // 다른 칸은 정상으로 바뀐다
  })

  it('몸체로 남의 userId를 보내도 계정 연결은 바뀌지 않는다', async () => {
    const { owner, groupId, tripId } = await tripWithMom()
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    const mom = TravelerSchema.parse(
      await readBody(
        await patchTraveler(
          patchRequest(owner.cookie, { userId: son.userId }),
          routeParams({ id: tripId, tid: 't1' }),
        ),
      ),
    )
    expect(mom.userId).toBeUndefined() // 그대로 연결 없음

    // 내 계정과 연결된 t2도 몸체로 떼어낼 수 없다
    const me = TravelerSchema.parse(
      await readBody(
        await patchTraveler(patchRequest(owner.cookie, { userId: undefined }), routeParams({ id: tripId, tid: 't2' })),
      ),
    )
    expect(me.userId).toBe(owner.userId)
  })

  it('없는 여행자는 404', async () => {
    const { owner, tripId } = await tripWithMom()
    const response = await patchTraveler(
      patchRequest(owner.cookie, { pace: 'slow' }),
      routeParams({ id: tripId, tid: 'no-such' }),
    )
    expect(response.status).toBe(404)
  })

  it('다른 여행의 여행자 id로는 고칠 수 없다 (404)', async () => {
    const { owner, groupId, tripId } = await tripWithMom()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })

    // 같은 id 't1'을 다른 여행에서 고치려 해도 그 여행에는 없다
    const response = await patchTraveler(
      patchRequest(owner.cookie, { pace: 'slow' }),
      routeParams({ id: otherTripId, tid: 't1' }),
    )
    expect(response.status).toBe(404)

    // 원래 여행의 't1'은 그대로다
    const still = TravelerSchema.parse(
      await readBody(
        await patchTraveler(patchRequest(owner.cookie, {}), routeParams({ id: tripId, tid: 't1' })),
      ),
    )
    expect(still.pace).toBe('unknown')
  })

  it('다른 그룹 사람은 403이고 값이 바뀌지 않는다', async () => {
    const { owner, tripId } = await tripWithMom()
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await patchTraveler(
      patchRequest(stranger.cookie, { label: '남이 바꾼 이름' }),
      routeParams({ id: tripId, tid: 't1' }),
    )
    expect(response.status).toBe(403)

    const detail = (await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId })))) as {
      travelers: Traveler[]
    }
    expect(detail.travelers[0].label).toBe('엄마')
  })
})
