// GET /api/groups/:id/trips — 그룹의 여행 목록. 구성원만 (아니면 403).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TripListItemSchema } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  addMember,
  createGroup as insertGroup,
  insertTrip,
  readBody,
  requestWith,
  routeParams,
  signUp,
} from '@/lib/auth/test-fixtures'
import { GET as getGroupTrips } from './[id]/trips/route'

const TripListSchema = z.array(TripListItemSchema)

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

describe('GET /api/groups/:id/trips', () => {
  it('구성원은 볼 수 있고, 최신·확정 버전은 4단계라 null이다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '첫 여행' })

    const response = await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))
    expect(response.status).toBe(200)

    // 화면이 쓰는 스키마로 검사한다 (배열을 그대로 기대한다)
    const list = TripListSchema.parse(await readBody(response))
    expect(list).toHaveLength(1)
    expect(list[0].trip.title).toBe('첫 여행')
    expect(list[0].latestVersion).toBeNull()
    expect(list[0].confirmedVersion).toBeNull()
  })

  it('최근에 만든 여행이 먼저 나온다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '예전 여행' })
    await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '새 여행' })

    const list = TripListSchema.parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list.map(one => one.trip.title)).toEqual(['새 여행', '예전 여행'])
  })

  it('여행이 없으면 빈 배열', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    const list = TripListSchema.parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list).toEqual([])
  })

  it('다른 그룹 여행은 섞이지 않는다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const other = await signUp({ name: '남', email: 'other@example.com' })
    const mine = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    const theirs = await insertGroup(testDb.db, { name: '남의 가족', ownerId: other.userId })
    await insertTrip(testDb.db, { groupId: mine, createdBy: owner.userId, title: '내 여행' })
    await insertTrip(testDb.db, { groupId: theirs, createdBy: other.userId, title: '남의 여행' })

    const list = TripListSchema.parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: mine }))),
    )
    expect(list.map(one => one.trip.title)).toEqual(['내 여행'])
  })

  it('다른 그룹 사람은 403이고 본문에 여행 제목이 없다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '우리만의 여행' })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await getGroupTrips(requestWith(stranger.cookie), routeParams({ id: groupId }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await readBody(response))).not.toContain('우리만의 여행')
  })

  it('구성원으로 들어온 사람은 볼 수 있다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '첫 여행' })
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    const response = await getGroupTrips(requestWith(mom.cookie), routeParams({ id: groupId }))
    expect(response.status).toBe(200)
  })

  it('로그인 안 하면 401', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    expect((await getGroupTrips(requestWith(), routeParams({ id: groupId }))).status).toBe(401)
  })
})
