// 여행 API 테스트. 응답 모양은 화면(api-client/real.ts)이 쓰는 계약 스키마로 검사한다.
// API마다 '다른 그룹 사람 → 403'을 확인한다 (역할 문서: 남의 그룹 데이터가 보이면 가장 심각한 버그).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema, TripDetailSchema, TripSchema } from '@/lib/contracts'
import type { Trip, TripDetail } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  createGroup as insertGroup,
  jsonRequestWith,
  readBody,
  requestWith,
  routeParams,
  signUp,
} from '@/lib/auth/test-fixtures'
import { POST as postTrip } from './route'
import { GET as getTrip, PATCH as patchTrip } from './[id]/route'

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

const postTripRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'POST', cookie, body, path: '/api/trips' })

const patchTripRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'PATCH', cookie, body, path: '/api/trips/x' })

// 그룹장 한 명과 그 그룹을 준비한다
async function ownerWithGroup() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  return { owner, groupId }
}

describe('POST /api/trips (여행 만들기)', () => {
  it('구성원은 만들 수 있고 응답이 Trip 모양이다', async () => {
    const { owner, groupId } = await ownerWithGroup()

    const response = await postTrip(
      postTripRequest(owner.cookie, { groupId, title: '부모님과 대전', date: '2026-11-15', mode: 'scratch' }),
    )
    expect(response.status).toBe(200)

    // 화면이 쓰는 스키마로 검사한다 — 모양이 어긋나면 여기서 걸린다
    const trip = TripSchema.parse(await readBody(response))
    expect(trip).toMatchObject({
      groupId,
      title: '부모님과 대전',
      date: '2026-11-15',
      mode: 'scratch',
      styles: [],
      confirmedVersionId: null, // 확정은 4단계
    })
    expect(trip.transport ?? null).toBeNull()
    expect(trip.budget ?? null).toBeNull()
  })

  it('날짜 없이도 만들 수 있다 (인터뷰에서 나중에 채운다)', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = TripSchema.parse(
      await readBody(await postTrip(postTripRequest(owner.cookie, { groupId, title: '대전 여행', mode: 'paste' }))),
    )
    expect(trip.date ?? null).toBeNull()
    expect(trip.mode).toBe('paste')
  })

  it('제목 앞뒤 공백은 지워지고, 공백만이면 400', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = TripSchema.parse(
      await readBody(
        await postTrip(postTripRequest(owner.cookie, { groupId, title: '  대전 여행  ', mode: 'scratch' })),
      ),
    )
    expect(trip.title).toBe('대전 여행')

    const bad = await postTrip(postTripRequest(owner.cookie, { groupId, title: '   ', mode: 'scratch' }))
    expect(bad.status).toBe(400)
  })

  it('날짜 형식이 틀리면 400', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const response = await postTrip(
      postTripRequest(owner.cookie, { groupId, title: '대전 여행', date: '2026/11/15', mode: 'scratch' }),
    )
    expect(response.status).toBe(400)
  })

  it('남의 그룹에 여행을 만들 수 없다 (403)', async () => {
    const { groupId } = await ownerWithGroup()
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await postTrip(postTripRequest(stranger.cookie, { groupId, title: '몰래', mode: 'scratch' }))
    expect(response.status).toBe(403)
    expect(ApiErrorSchema.parse(await readBody(response)).error.code).toBe('forbidden')
  })

  it('로그인 안 하면 401', async () => {
    const { groupId } = await ownerWithGroup()
    const response = await postTrip(postTripRequest(undefined, { groupId, title: '대전 여행', mode: 'scratch' }))
    expect(response.status).toBe(401)
  })
})

describe('GET /api/trips/:id (여행 조회)', () => {
  it('구성원은 볼 수 있고 응답이 TripDetail 모양이다 (versions는 4단계라 빈 배열)', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const created = TripSchema.parse(
      await readBody(await postTrip(postTripRequest(owner.cookie, { groupId, title: '대전 여행', mode: 'scratch' }))),
    )

    const detail = TripDetailSchema.parse(
      await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: created.id }))),
    )
    expect(detail.trip.id).toBe(created.id)
    expect(detail.travelers).toEqual([])
    expect(detail.versions).toEqual([])
  })

  it('다른 그룹 사람은 403이고 본문에 여행 정보가 없다', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const tripId = (
      TripSchema.parse(
        await readBody(await postTrip(postTripRequest(owner.cookie, { groupId, title: '우리만의 일정', mode: 'scratch' }))),
      )
    ).id
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await getTrip(requestWith(stranger.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await readBody(response))).not.toContain('우리만의 일정')
  })

  it('없는 여행도 403 (404로 나누면 그 여행이 있다는 사실이 새어 나간다)', async () => {
    const { owner } = await ownerWithGroup()
    const response = await getTrip(requestWith(owner.cookie), routeParams({ id: 'no-such-trip' }))
    expect(response.status).toBe(403)
  })

  it('로그인 안 했으면 403이 아니라 401', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const tripId = (
      TripSchema.parse(
        await readBody(await postTrip(postTripRequest(owner.cookie, { groupId, title: '대전 여행', mode: 'scratch' }))),
      )
    ).id

    const response = await getTrip(requestWith(), routeParams({ id: tripId }))
    expect(response.status).toBe(401)
  })
})

describe('PATCH /api/trips/:id (여행 고치기)', () => {
  async function tripOf(cookie: string, groupId: string): Promise<Trip> {
    return TripSchema.parse(
      await readBody(await postTrip(postTripRequest(cookie, { groupId, title: '대전 여행', mode: 'scratch' }))),
    )
  }

  it('보낸 칸만 바뀐다', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = await tripOf(owner.cookie, groupId)

    const updated = TripSchema.parse(
      await readBody(
        await patchTrip(
          patchTripRequest(owner.cookie, { transport: 'car', styles: ['자연', '맛집'], budget: '30k_50k' }),
          routeParams({ id: trip.id }),
        ),
      ),
    )
    expect(updated).toMatchObject({ transport: 'car', styles: ['자연', '맛집'], budget: '30k_50k' })
    expect(updated.title).toBe('대전 여행') // 안 보낸 칸은 그대로
  })

  it('날짜·이동수단을 null로 보내면 비운다', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = await tripOf(owner.cookie, groupId)
    await patchTrip(patchTripRequest(owner.cookie, { date: '2026-11-15' }), routeParams({ id: trip.id }))

    const cleared = TripSchema.parse(
      await readBody(await patchTrip(patchTripRequest(owner.cookie, { date: null }), routeParams({ id: trip.id }))),
    )
    expect(cleared.date ?? null).toBeNull()
  })

  it('빈 몸체면 지금 값을 그대로 돌려준다', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = await tripOf(owner.cookie, groupId)

    const same = TripSchema.parse(
      await readBody(await patchTrip(patchTripRequest(owner.cookie, {}), routeParams({ id: trip.id }))),
    )
    expect(same).toEqual(trip)
  })

  it('제목을 빈 문자로 바꾸려 하면 400', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = await tripOf(owner.cookie, groupId)
    const response = await patchTrip(patchTripRequest(owner.cookie, { title: '' }), routeParams({ id: trip.id }))
    expect(response.status).toBe(400)
  })

  it('다른 그룹 사람은 403이고 값이 바뀌지 않는다', async () => {
    const { owner, groupId } = await ownerWithGroup()
    const trip = await tripOf(owner.cookie, groupId)
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await patchTrip(
      patchTripRequest(stranger.cookie, { title: '남이 바꾼 제목' }),
      routeParams({ id: trip.id }),
    )
    expect(response.status).toBe(403)

    const detail = (await readBody(
      await getTrip(requestWith(owner.cookie), routeParams({ id: trip.id })),
    )) as TripDetail
    expect(detail.trip.title).toBe('대전 여행')
  })
})
