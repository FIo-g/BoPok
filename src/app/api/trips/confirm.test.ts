// 확정·확정 풀기 테스트. '여행당 한 버전'과 '누가 확정했는지'를 고정한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiErrorSchema, TripListItemSchema, TripSchema } from '@/lib/contracts'
import type { Trip } from '@/lib/contracts'
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
  stop,
} from '@/lib/auth/test-fixtures'
import { saveVersion } from '@/lib/trips/versions'
import { DELETE as unconfirmRoute, POST as confirmRoute } from './[id]/confirm/route'
import { GET as getGroupTrips } from '../groups/[id]/trips/route'

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

const confirmRequest = (cookie: string | undefined, versionId: string) =>
  jsonRequestWith({ method: 'POST', cookie, body: { versionId }, path: '/api/trips/x/confirm' })

const unconfirmRequest = (cookie?: string) =>
  jsonRequestWith({ method: 'DELETE', cookie, path: '/api/trips/x/confirm' })

// 그룹장·엄마·여행·버전 두 개를 준비한다
async function tripWithTwoVersions() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
  await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })

  const stops = [stop({ key: 's1', name: '한밭수목원' })]
  const first = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops, madeBy: 'user' } })
  const second = await saveVersion({
    tripId,
    userId: owner.userId,
    input: { parentId: first.id, stops, madeBy: 'user' },
  })
  return { owner, mom, groupId, tripId, first, second }
}

describe('POST /api/trips/:id/confirm (확정)', () => {
  it('구성원이 확정하면 버전 id와 확정한 사람 이름이 남는다', async () => {
    const { mom, tripId, second } = await tripWithTwoVersions()

    const response = await confirmRoute(confirmRequest(mom.cookie, second.id), routeParams({ id: tripId }))
    expect(response.status).toBe(200)

    const trip = TripSchema.parse(await readBody(response))
    expect(trip.confirmedVersionId).toBe(second.id)
    expect(trip.confirmedByName).toBe('엄마') // 그룹장이 아니어도 확정할 수 있다 (설계 10.4)
  })

  it('다른 버전을 확정하면 이전 확정은 풀린다 (여행당 한 버전)', async () => {
    const { owner, mom, tripId, first, second } = await tripWithTwoVersions()
    await confirmRoute(confirmRequest(mom.cookie, second.id), routeParams({ id: tripId }))

    const trip = TripSchema.parse(
      await readBody(await confirmRoute(confirmRequest(owner.cookie, first.id), routeParams({ id: tripId }))),
    )
    expect(trip.confirmedVersionId).toBe(first.id) // 덮어써졌다
    expect(trip.confirmedByName).toBe('김경선') // 마지막으로 확정한 사람
  })

  it('같은 버전을 다시 확정해도 그대로 성공한다', async () => {
    const { owner, tripId, first } = await tripWithTwoVersions()
    await confirmRoute(confirmRequest(owner.cookie, first.id), routeParams({ id: tripId }))

    const trip = TripSchema.parse(
      await readBody(await confirmRoute(confirmRequest(owner.cookie, first.id), routeParams({ id: tripId }))),
    )
    expect(trip.confirmedVersionId).toBe(first.id)
  })

  it('다른 여행의 버전으로 확정하려 하면 400', async () => {
    const { owner, groupId, tripId } = await tripWithTwoVersions()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const otherVersion = await saveVersion({
      tripId: otherTripId,
      userId: owner.userId,
      input: { parentId: null, stops: [stop({ key: 's1', name: '엑스포과학공원' })], madeBy: 'user' },
    })

    const response = await confirmRoute(confirmRequest(owner.cookie, otherVersion.id), routeParams({ id: tripId }))
    expect(response.status).toBe(400)
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('확정할 버전을 찾을 수 없어요')
  })

  it('다른 그룹 사람은 403이고 확정되지 않는다', async () => {
    const { owner, tripId, second } = await tripWithTwoVersions()
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await confirmRoute(confirmRequest(stranger.cookie, second.id), routeParams({ id: tripId }))
    expect(response.status).toBe(403)

    const after = TripSchema.parse(
      await readBody(await unconfirmRoute(unconfirmRequest(owner.cookie), routeParams({ id: tripId }))),
    )
    expect(after.confirmedVersionId).toBeNull()
  })

  it('로그인 안 하면 401', async () => {
    const { tripId, second } = await tripWithTwoVersions()
    expect((await confirmRoute(confirmRequest(undefined, second.id), routeParams({ id: tripId }))).status).toBe(401)
  })
})

describe('DELETE /api/trips/:id/confirm (확정 풀기)', () => {
  it('확정이 풀리고 이름도 비워진다', async () => {
    const { mom, tripId, second } = await tripWithTwoVersions()
    await confirmRoute(confirmRequest(mom.cookie, second.id), routeParams({ id: tripId }))

    const trip = TripSchema.parse(
      await readBody(await unconfirmRoute(unconfirmRequest(mom.cookie), routeParams({ id: tripId }))),
    )
    expect(trip.confirmedVersionId).toBeNull()
    expect(trip.confirmedByName ?? null).toBeNull()
  })

  it('이미 안 된 상태에서 눌러도 그대로 성공한다', async () => {
    const { owner, tripId } = await tripWithTwoVersions()
    const trip = (await readBody(
      await unconfirmRoute(unconfirmRequest(owner.cookie), routeParams({ id: tripId })),
    )) as Trip
    expect(trip.confirmedVersionId).toBeNull()
  })

  it('다른 그룹 사람은 403이고 확정이 그대로 남는다', async () => {
    const { owner, groupId, tripId, second } = await tripWithTwoVersions()
    await confirmRoute(confirmRequest(owner.cookie, second.id), routeParams({ id: tripId }))
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await unconfirmRoute(unconfirmRequest(stranger.cookie), routeParams({ id: tripId }))
    expect(response.status).toBe(403)

    // 확정이 풀리지 않았다
    const list = z.array(TripListItemSchema).parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list[0].confirmedVersion?.id).toBe(second.id)
  })
})

describe('여행 목록의 confirmedVersion (4단계에서 비워 둔 자리)', () => {
  it('확정하면 목록의 confirmedVersion이 채워진다', async () => {
    const { owner, groupId, tripId, second } = await tripWithTwoVersions()
    await confirmRoute(confirmRequest(owner.cookie, second.id), routeParams({ id: tripId }))

    const list = z.array(TripListItemSchema).parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list[0].confirmedVersion?.id).toBe(second.id)
    expect(list[0].confirmedVersion?.number).toBe(2)
    expect(list[0].latestVersion?.id).toBe(second.id)
    expect(list[0].trip.confirmedByName).toBe('김경선')
  })

  it('확정을 풀면 다시 null이 된다', async () => {
    const { owner, groupId, tripId, second } = await tripWithTwoVersions()
    await confirmRoute(confirmRequest(owner.cookie, second.id), routeParams({ id: tripId }))
    await unconfirmRoute(unconfirmRequest(owner.cookie), routeParams({ id: tripId }))

    const list = z.array(TripListItemSchema).parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list[0].confirmedVersion).toBeNull()
    expect(list[0].latestVersion?.number).toBe(2) // 최신은 그대로 있다
  })
})
