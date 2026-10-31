// 버전 API 테스트. 응답은 화면(api-client/real.ts)이 쓰는 계약 스키마로 검사한다.
// API마다 '다른 그룹 사람 → 403'을 확인한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema, TripDetailSchema, TripListItemSchema, TripVersionSchema } from '@/lib/contracts'
import type { TripDetail, TripListItem, TripVersion } from '@/lib/contracts'
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
  stop,
  traveler,
} from '@/lib/auth/test-fixtures'
import { replaceTravelers } from '@/lib/trips/travelers'
import { GET as getTrip } from './[id]/route'
import { POST as postVersion } from './[id]/versions/route'
import { GET as getVersionRoute } from './[id]/versions/[vid]/route'
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

const saveRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'POST', cookie, body, path: '/api/trips/x/versions' })

const twoStops = [
  stop({ key: 's1', name: '한밭수목원', placeId: 'hanbat', mustVisit: true, startTime: '10:00', visitMin: 60 }),
  stop({ key: 's2', name: '점심 (도롱이마을)', seated: true, arriveBy: 'car' }),
]

async function tripFor() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  return { owner, groupId, tripId }
}

async function save(cookie: string, tripId: string, body: unknown): Promise<TripVersion> {
  const response = await postVersion(saveRequest(cookie, body), routeParams({ id: tripId }))
  expect(response.status).toBe(200)
  return TripVersionSchema.parse(await readBody(response))
}

describe('POST /api/trips/:id/versions (버전 저장)', () => {
  it('고른 장소를 저장하고 TripVersion 모양으로 돌려준다', async () => {
    const { owner, tripId } = await tripFor()

    const version = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })
    expect(version).toMatchObject({ tripId, number: 1, parentId: null, madeBy: 'user', madeByUserId: owner.userId })
    expect(version.stops).toHaveLength(2)
    expect(version.stops[0]).toMatchObject({ key: 's1', name: '한밭수목원', mustVisit: true, startTime: '10:00' })
    expect(version.summary ?? null).toBeNull() // 이 여행엔 여행자가 없어서 판정하지 않는다
  })

  it('빠른 수정안(quick_fix)도 저장된다', async () => {
    const { owner, tripId } = await tripFor()
    const first = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })

    const fixed = await save(owner.cookie, tripId, {
      parentId: first.id,
      stops: [twoStops[0]],
      madeBy: 'quick_fix',
      note: '계단 많은 곳을 뺐어요',
    })
    expect(fixed).toMatchObject({ number: 2, madeBy: 'quick_fix', parentId: first.id, note: '계단 많은 곳을 뺐어요' })
  })

  it('madeBy가 ai면 400 (AI 버전은 API가 아니라 서버 함수로 저장한다)', async () => {
    const { owner, tripId } = await tripFor()
    const response = await postVersion(
      saveRequest(owner.cookie, { parentId: null, stops: twoStops, madeBy: 'ai' }),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(400)
  })

  it('다른 여행의 버전을 parentId로 주면 400', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const otherVersion = await save(owner.cookie, otherTripId, { parentId: null, stops: twoStops, madeBy: 'user' })

    const response = await postVersion(
      saveRequest(owner.cookie, { parentId: otherVersion.id, stops: twoStops, madeBy: 'user' }),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(400)
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('이전 버전을 찾을 수 없어요')
  })

  it('stops가 비어 있어도 저장된다 (장소를 다 뺀 일정도 한 판이다)', async () => {
    const { owner, tripId } = await tripFor()
    const version = await save(owner.cookie, tripId, { parentId: null, stops: [], madeBy: 'user' })
    expect(version.stops).toEqual([])
  })

  it('다른 그룹 사람은 403이고 버전이 생기지 않는다', async () => {
    const { owner, tripId } = await tripFor()
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await postVersion(
      saveRequest(stranger.cookie, { parentId: null, stops: twoStops, madeBy: 'user' }),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(403)

    const detail = (await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId })))) as TripDetail
    expect(detail.versions).toEqual([])
  })

  it('로그인 안 하면 401', async () => {
    const { tripId } = await tripFor()
    const response = await postVersion(
      saveRequest(undefined, { parentId: null, stops: twoStops, madeBy: 'user' }),
      routeParams({ id: tripId }),
    )
    expect(response.status).toBe(401)
  })
})

describe('GET /api/trips/:id/versions/:vid (버전 조회)', () => {
  it('stops까지 담아 돌려준다', async () => {
    const { owner, tripId } = await tripFor()
    const saved = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })

    const response = await getVersionRoute(requestWith(owner.cookie), routeParams({ id: tripId, vid: saved.id }))
    expect(response.status).toBe(200)
    const version = TripVersionSchema.parse(await readBody(response))
    expect(version.id).toBe(saved.id)
    expect(version.stops.map(one => one.name)).toEqual(['한밭수목원', '점심 (도롱이마을)'])
  })

  it('다른 여행의 버전 id면 404 (버전 id가 새는 것을 막는다)', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const saved = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })

    const response = await getVersionRoute(
      requestWith(owner.cookie),
      routeParams({ id: otherTripId, vid: saved.id }),
    )
    expect(response.status).toBe(404)
  })

  it('다른 그룹 사람은 403이고 본문에 장소 이름이 없다', async () => {
    const { owner, tripId } = await tripFor()
    const saved = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await getVersionRoute(requestWith(stranger.cookie), routeParams({ id: tripId, vid: saved.id }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await readBody(response))).not.toContain('한밭수목원')
  })

  it('로그인 안 하면 401', async () => {
    const { owner, tripId } = await tripFor()
    const saved = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })
    const response = await getVersionRoute(requestWith(), routeParams({ id: tripId, vid: saved.id }))
    expect(response.status).toBe(401)
  })
})

describe('3단계에서 비워 둔 곳이 채워진다', () => {
  it('GET /api/trips/:id의 versions에 요약이 번호 오름차순으로 들어간다 (stops 없음)', async () => {
    const { owner, tripId } = await tripFor()
    const first = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })
    await save(owner.cookie, tripId, { parentId: first.id, stops: [twoStops[0]], madeBy: 'quick_fix' })

    const detail = TripDetailSchema.parse(
      await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId }))),
    )
    expect(detail.versions.map(one => one.number)).toEqual([1, 2])
    // 누가 만들었는지 이름을 서버가 채운다 (목업 summaryOf와 같다)
    expect(detail.versions[0].madeByName).toBe('김경선')
    // 요약에는 stops가 없다 (목록이 가벼워야 한다)
    expect('stops' in detail.versions[0]).toBe(false)
  })

  it('GET /api/groups/:id/trips의 latestVersion이 마지막 버전이고 confirmedVersion은 아직 null', async () => {
    const { owner, groupId, tripId } = await tripFor()
    await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })
    const second = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })

    const list = z.array(TripListItemSchema).parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list[0].latestVersion?.id).toBe(second.id)
    expect(list[0].latestVersion?.number).toBe(2)
    expect(list[0].confirmedVersion).toBeNull() // 확정은 5단계
  })

  it('버전이 없는 여행은 latestVersion이 null이다', async () => {
    const { owner, groupId } = await tripFor()
    const list = (await readBody(
      await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId })),
    )) as TripListItem[]
    expect(list[0].latestVersion).toBeNull()
  })

  it('다른 구성원이 만든 버전도 이름이 함께 나온다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })
    await save(mom.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })

    const detail = TripDetailSchema.parse(
      await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId }))),
    )
    expect(detail.versions[0].madeByName).toBe('엄마')
  })
})

describe('6단계 — 판정 요약이 저장되고 목록에 나온다', () => {
  it('여행자가 있으면 POST 응답·여행 상세·여행 목록에 같은 요약이 들어간다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    await replaceTravelers({
      tripId,
      travelers: [traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })],
    })

    // 이 테스트 DB에는 장소가 없어서 장소·경로를 모른다 → 외부 호출 없이 '정보 부족'이고 걷는 시간은 0이다
    const version = await save(owner.cookie, tripId, { parentId: null, stops: twoStops, madeBy: 'user' })
    expect(version.summary).toMatchObject({ verdict: 'info', day: { base: 0, high: 0 } })

    const detail = TripDetailSchema.parse(
      await readBody(await getTrip(requestWith(owner.cookie), routeParams({ id: tripId }))),
    )
    expect(detail.versions[0].summary).toEqual(version.summary)

    const list = z.array(TripListItemSchema).parse(
      await readBody(await getGroupTrips(requestWith(owner.cookie), routeParams({ id: groupId }))),
    )
    expect(list[0].latestVersion?.summary).toEqual(version.summary)
  })
})
