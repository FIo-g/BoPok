// 판정 요약 연결(6단계). TMAP을 실제로 부르지 않으려고 장소·경로 함수를 가짜로 바꿔 끼운다.
// 가장 중요한 성질: 요약 계산이 실패하거나 느려도 버전·여행자 저장은 반드시 성공한다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceDetail } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { hanbat } from '@/lib/engine/test-fixtures'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { createGroup as insertGroup, insertTrip, signUp, stop, traveler } from '@/lib/auth/test-fixtures'
import type { PlaceGeoDeps } from './place-geo'
import { setPlaceGeoDepsForTests } from './place-geo'
import { setSummaryTimeoutForTests } from './judge-run'
import { createVersion, getVersion, listVersionSummaries, saveVersion } from './versions'
import { patchTraveler, replaceTravelers, saveTravelers } from './travelers'

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  // TMAP 키를 비워 둔다 — 실수로 진짜 경로 함수가 불려도 네트워크 전에 막힌다.
  vi.stubEnv('TMAP_APP_KEY', '')
  testDb = await setupTestDb()
  // 제한 시간 60초: PGlite 띄우기가 1.6초쯤 걸려 vitest 기본값으로는 모자랄 수 있다.
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterEach(() => {
  // 다음 테스트가 진짜 함수·기본 제한 시간으로 돌아가게 되돌린다.
  setPlaceGeoDepsForTests(null)
  setSummaryTimeoutForTests(null)
  vi.restoreAllMocks()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

const oneStop = [stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id })]

// 장소 사이를 걸어가는 일정 — 이래야 경로 함수(getLegs)가 불린다
const twoWalkStops = [
  stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id }),
  stop({ key: 's2', name: '정원 카페', arriveBy: 'walk', coord: [127.386, 36.3512] }),
]
const mom = traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })

// 장소 하나를 아는 가짜 deps. 경로는 걷기만 돌려준다
function depsWith(place: PlaceDetail): PlaceGeoDeps {
  return {
    getPlaceDetails: async ids => (ids.includes(place.id) ? [place] : []),
    getLegs: async requests => {
      return requests
        .filter(request => request.mode === 'walk')
        .map(request => ({
          key: legKey(request),
          mode: 'walk' as const,
          distanceM: 500,
          path: [request.from.coord, request.to.coord],
          stairsStatus: 'unknown' as const,
          confidence: 'C' as const,
          source: '테스트용 가짜 값',
        }))
    },
  }
}

async function tripWith(travelers = [mom]) {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  if (travelers.length > 0) await replaceTravelers({ tripId, travelers }, testDb.db)
  return { owner, groupId, tripId }
}

const saveOne = (tripId: string, userId: string) =>
  saveVersion({ tripId, userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })

describe('버전을 저장할 때 판정 요약도 저장된다', () => {
  it('summary에 판정·이유·하루 총·가장 긴 연속이 들어간다', async () => {
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { owner, tripId } = await tripWith()

    const version = await saveOne(tripId, owner.userId)
    expect(version.summary).not.toBeNull()
    expect(version.summary).toMatchObject({
      verdict: expect.stringMatching(/^(ok|adjust|info)$/),
      reason: expect.any(String),
    })
    expect(version.summary?.day.base).toBeGreaterThan(0) // 장소를 알면 걷는 시간이 나온다

    // 조회·목록에도 같은 값이 담긴다
    const read = await getVersion({ tripId, versionId: version.id })
    expect(read.summary).toEqual(version.summary)
    const summaries = await listVersionSummaries(tripId)
    expect(summaries[0].summary).toEqual(version.summary)
  })

  it('AI가 부르는 createVersion도 같은 길을 쓴다', async () => {
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { tripId } = await tripWith()

    const version = await createVersion(tripId, { parentId: null, stops: oneStop, madeBy: 'ai' })
    expect(version.summary).not.toBeNull()
  })

  it('여행자가 0명이면 요약은 null이고 장소·경로를 아예 부르지 않는다', async () => {
    let called = 0
    setPlaceGeoDepsForTests({
      getPlaceDetails: async () => {
        called += 1
        return []
      },
      getLegs: async () => {
        called += 1
        return []
      },
    })
    const { owner, tripId } = await tripWith([])

    const version = await saveOne(tripId, owner.userId)
    expect(version.summary ?? null).toBeNull()
    expect(called).toBe(0)
  })
})

describe('요약이 실패해도 저장은 성공한다', () => {
  it('장소 함수가 던져도 버전은 저장되고 요약만 null이다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    setPlaceGeoDepsForTests({
      getPlaceDetails: async () => {
        throw new Error('장소 DB가 응답하지 않아요')
      },
      getLegs: async () => [],
    })
    const { owner, tripId } = await tripWith()

    const version = await saveOne(tripId, owner.userId)
    expect(version.id).toBeTruthy() // 저장은 됐다
    expect(version.summary ?? null).toBeNull()
    expect(version.stops).toHaveLength(1)
    expect(logged).toHaveBeenCalled()
  })

  it('경로 함수가 던져도 같다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    setPlaceGeoDepsForTests({
      getPlaceDetails: async () => [hanbat],
      getLegs: async () => {
        throw new Error('TMAP이 응답하지 않아요')
      },
    })
    const { owner, tripId } = await tripWith()

    const version = await saveVersion({
      tripId,
      userId: owner.userId,
      input: { parentId: null, stops: twoWalkStops, madeBy: 'user' },
    })
    expect(version.id).toBeTruthy()
    expect(version.summary ?? null).toBeNull()
    expect(logged).toHaveBeenCalled()
  })

  it('요약이 느리면 제한 시간 뒤에 기다리지 않고 null로 저장한다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSummaryTimeoutForTests(50) // 테스트가 진짜로 8초 기다리지 않게 바꿔 끼운다
    setPlaceGeoDepsForTests({
      getPlaceDetails: async () => [hanbat],
      getLegs: async () => {
        // 느린 TMAP을 흉내 낸다
        await new Promise(resolve => setTimeout(resolve, 3_000))
        return []
      },
    })
    const { owner, tripId } = await tripWith()

    const started = Date.now()
    const version = await saveVersion({
      tripId,
      userId: owner.userId,
      input: { parentId: null, stops: twoWalkStops, madeBy: 'user' },
    })
    const took = Date.now() - started

    expect(version.summary ?? null).toBeNull()
    expect(took).toBeLessThan(2_000) // 느린 경로를 끝까지 기다리지 않았다
    expect(JSON.stringify(logged.mock.calls)).toContain('시간 초과')
  })

  it('자가용 구간이 섞여도 오류 없이 저장된다', async () => {
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { owner, tripId } = await tripWith()

    const version = await saveVersion({
      tripId,
      userId: owner.userId,
      input: {
        parentId: null,
        stops: [
          stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id }),
          stop({ key: 's2', name: '점심', arriveBy: 'car', coord: [127.385, 36.3315] }),
        ],
        madeBy: 'user',
      },
    })

    expect(version.summary).not.toBeNull()
  })
})

describe('여행자가 바뀌면 그 여행의 버전 요약을 다시 계산한다', () => {
  it('PUT으로 걷기 조건을 바꾸면 모든 버전 요약이 바뀐다', async () => {
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { owner, tripId } = await tripWith()
    const first = await saveOne(tripId, owner.userId)
    const second = await saveOne(tripId, owner.userId)
    const before = first.summary?.day.base
    expect(before).toBeGreaterThan(0)

    // 더 느리게 걷는 조건으로 바꾼다 → 걷는 시간이 늘어야 한다
    await replaceTravelers(
      { tripId, travelers: [{ ...mom, age: 85, pace: 'slow' }] },
      testDb.db,
    )

    const summaries = await listVersionSummaries(tripId)
    expect(summaries).toHaveLength(2)
    expect(summaries[0].summary?.day.base).toBeGreaterThan(before!)
    expect(summaries[1].summary?.day.base).toBeGreaterThan(before!)
    expect(summaries.map(one => one.id)).toEqual([first.id, second.id])
  })

  it('PATCH로 한 사람만 고쳐도 다시 계산된다', async () => {
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { owner, tripId } = await tripWith()
    const version = await saveOne(tripId, owner.userId)
    const before = version.summary?.day.base

    await patchTraveler({ tripId, travelerId: mom.id, patch: { age: 85, pace: 'slow' } }, testDb.db)

    const read = await getVersion({ tripId, versionId: version.id })
    expect(read.summary?.day.base).toBeGreaterThan(before!)
  })

  it('AI saveTravelers로 바꿔도 다시 계산된다', async () => {
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { owner, tripId } = await tripWith()
    const version = await saveOne(tripId, owner.userId)
    const before = version.summary?.day.base

    await saveTravelers(tripId, [{ ...mom, age: 85, pace: 'slow' }])

    const read = await getVersion({ tripId, versionId: version.id })
    expect(read.summary?.day.base).toBeGreaterThan(before!)
    void owner
  })

  it('요약 재계산이 실패해도 여행자 저장은 성공한다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    setPlaceGeoDepsForTests(depsWith(hanbat))
    const { owner, tripId } = await tripWith()
    await saveOne(tripId, owner.userId)

    // 저장 뒤 재계산에서 장소 함수가 터지게 한다
    setPlaceGeoDepsForTests({
      getPlaceDetails: async () => {
        throw new Error('장소 DB가 응답하지 않아요')
      },
      getLegs: async () => [],
    })

    const saved = await replaceTravelers({ tripId, travelers: [{ ...mom, age: 85 }] }, testDb.db)
    expect(saved[0].age).toBe(85) // 여행자 저장은 성공했다
    const summaries = await listVersionSummaries(tripId)
    expect(summaries[0].summary ?? null).toBeNull() // 요약만 비워졌다
    expect(logged).toHaveBeenCalled()
  })
})
