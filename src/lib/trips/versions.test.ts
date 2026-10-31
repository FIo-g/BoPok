// 버전 번호 매기기와 AI 창구(createVersion·getOpinions)를 본다.
// 번호는 db.transaction()을 못 쓰는 상황에서 겹치지 않아야 하므로 여기서 집중해 확인한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiDeps } from '@/lib/ai/deps'
import { OpinionSchema } from '@/lib/contracts'
import { tripVersions } from '@/lib/db/schema'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  addMember,
  createGroup as insertGroup,
  insertOpinion,
  insertTrip,
  signUp,
  stop,
  traveler,
} from '@/lib/auth/test-fixtures'
import { hanbat } from '@/lib/engine/test-fixtures'
import { GeoError } from '@/lib/geo/errors'
import { createVersion, getVersion, listVersions, listVersionSummaries, saveVersion } from './versions'
import { getOpinions } from './opinions'
import { getTripContext } from './context'
import { judgeStops, summaryOf } from './judge-run'
import type { PlaceGeoDeps } from './place-geo'
import { createPlaceGeoDeps } from './place-geo'
import { listTravelers, replaceTravelers } from './travelers'
import { listGroupTrips } from './trips'

// 타입만으로 하는 검사 — 태형님 deps 모양과 어긋나면 pnpm build에서 걸린다.
const _createVersion: AiDeps['createVersion'] = createVersion
const _getOpinions: AiDeps['getOpinions'] = getOpinions
const _getTripContext: AiDeps['getTripContext'] = getTripContext
void _createVersion
void _getOpinions
void _getTripContext

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

async function tripFor() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  return { owner, groupId, tripId }
}

const oneStop = [stop({ key: 's1', name: '한밭수목원' })]

describe('버전 번호', () => {
  it('여행마다 1부터 하나씩 올라간다', async () => {
    const { owner, tripId } = await tripFor()

    const first = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    const second = await saveVersion({ tripId, userId: owner.userId, input: { parentId: first.id, stops: oneStop, madeBy: 'user' } })
    const third = await saveVersion({ tripId, userId: owner.userId, input: { parentId: second.id, stops: oneStop, madeBy: 'quick_fix' } })

    expect([first.number, second.number, third.number]).toEqual([1, 2, 3])
  })

  it('여행이 다르면 번호도 따로 센다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })

    await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    const other = await saveVersion({
      tripId: otherTripId,
      userId: owner.userId,
      input: { parentId: null, stops: oneStop, madeBy: 'user' },
    })
    expect(other.number).toBe(1)
  })

  it('두 명이 동시에 저장해도 번호가 겹치지 않는다', async () => {
    const { owner, tripId } = await tripFor()

    const saved = await Promise.all(
      [1, 2, 3, 4].map(() =>
        saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } }),
      ),
    )

    const numbers = saved.map(one => one.number).sort((a, b) => a - b)
    expect(numbers).toEqual([1, 2, 3, 4]) // 겹치거나 빠진 번호가 없다
    expect(new Set(saved.map(one => one.id)).size).toBe(4)
  })

  it('번호가 이미 차 있으면 다시 세어 넣는다 (유니크 제약에 걸린 뒤 재시도)', async () => {
    const { owner, tripId } = await tripFor()

    // 1번을 다른 경로로 먼저 넣어 둔다 → 세어 보면 다음은 2번이어야 한다
    await testDb.db.insert(tripVersions).values({
      tripId,
      number: 1,
      parentId: null,
      madeBy: 'user',
      madeByUserId: owner.userId,
      stops: oneStop,
    })

    const saved = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    expect(saved.number).toBe(2)
  })
})

describe('createVersion (AI가 부르는 창구)', () => {
  it('madeBy는 ai로 저장되고 같은 번호 매기기를 쓴다', async () => {
    const { owner, tripId } = await tripFor()
    const first = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })

    const aiVersion = await createVersion(tripId, {
      parentId: first.id,
      stops: oneStop,
      madeBy: 'ai',
      madeByUserId: owner.userId,
      note: '의견을 반영해 다듬었어요',
      appliedOpinionIds: [],
    })

    expect(aiVersion).toMatchObject({ number: 2, madeBy: 'ai', parentId: first.id, note: '의견을 반영해 다듬었어요' })
    expect(aiVersion.summary ?? null).toBeNull() // 여행자가 없어서 판정하지 않는다
  })

  it('다른 여행의 버전을 parentId로 주면 400', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const otherVersion = await saveVersion({
      tripId: otherTripId,
      userId: owner.userId,
      input: { parentId: null, stops: oneStop, madeBy: 'user' },
    })

    await expect(
      createVersion(tripId, { parentId: otherVersion.id, stops: oneStop, madeBy: 'ai' }),
    ).rejects.toThrow('이전 버전을 찾을 수 없어요')
  })
})

describe('getTripContext의 versions', () => {
  it('stops까지 담아 번호 오름차순으로 돌려준다 (AI가 이전 일정을 봐야 한다)', async () => {
    const { owner, tripId } = await tripFor()
    await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    await saveVersion({
      tripId,
      userId: owner.userId,
      input: { parentId: null, stops: [stop({ key: 's2', name: '대전시립미술관' })], madeBy: 'user' },
    })

    const context = await getTripContext(tripId)
    expect(context.versions.map(one => one.number)).toEqual([1, 2])
    expect(context.versions[1].stops[0].name).toBe('대전시립미술관')
  })
})

describe('getOpinions (AI가 부르는 창구)', () => {
  it('의견이 없으면 빈 배열 (5단계까지는 이게 정상)', async () => {
    const { owner, tripId } = await tripFor()
    const version = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })

    await expect(getOpinions(version.id)).resolves.toEqual([])
  })

  it('DB에 넣은 의견을 계약 모양으로 꺼낸다 (userName은 서버가 채운다)', async () => {
    const { owner, tripId } = await tripFor()
    const version = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    await insertOpinion(testDb.db, {
      versionId: version.id,
      userId: owner.userId,
      stopKey: 's1',
      reactions: ['too_far', 'need_rest'],
      comment: '여기까지 걷기는 좀 멀어요',
    })

    const opinions = await getOpinions(version.id)
    expect(opinions).toHaveLength(1)
    // 화면·AI가 쓰는 계약 스키마로 검사한다
    const parsed = OpinionSchema.parse(opinions[0])
    expect(parsed).toMatchObject({
      versionId: version.id,
      stopKey: 's1',
      userId: owner.userId,
      userName: '김경선',
      reactions: ['too_far', 'need_rest'],
      comment: '여기까지 걷기는 좀 멀어요',
    })
    expect(parsed.appliedInVersionId ?? null).toBeNull() // 반영 표시는 5단계
  })

  it('다른 버전의 의견은 섞이지 않는다', async () => {
    const { owner, tripId } = await tripFor()
    const first = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    const second = await saveVersion({ tripId, userId: owner.userId, input: { parentId: first.id, stops: oneStop, madeBy: 'user' } })
    await insertOpinion(testDb.db, { versionId: first.id, userId: owner.userId, reactions: ['must_go'] })

    await expect(getOpinions(second.id)).resolves.toEqual([])
    await expect(getOpinions(first.id)).resolves.toHaveLength(1)
  })
})

describe('getVersion·listVersions', () => {
  it('그 여행의 버전이 아니면 404', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const version = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })

    await expect(getVersion({ tripId: otherTripId, versionId: version.id })).rejects.toThrow('버전을 찾을 수 없어요')
    await expect(listVersions(otherTripId)).resolves.toEqual([])
  })
})

describe('createVersion의 appliedOpinionIds (의견 반영 표시)', () => {
  it('그 여행의 의견이면 appliedInVersionId가 찍힌다', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    const first = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    const opinionId = await insertOpinion(testDb.db, {
      versionId: first.id,
      userId: mom.userId,
      stopKey: 's1',
      reactions: ['too_far'],
    })

    const revised = await createVersion(tripId, {
      parentId: first.id,
      stops: oneStop,
      madeBy: 'ai',
      note: '의견을 반영했어요',
      appliedOpinionIds: [opinionId],
    })

    const opinions = await getOpinions(first.id)
    expect(opinions[0].appliedInVersionId).toBe(revised.id)
  })

  it('다른 여행의 의견 id는 건너뛰고, 새 버전은 그대로 저장된다 (로그만 남긴다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const otherVersion = await saveVersion({
      tripId: otherTripId,
      userId: owner.userId,
      input: { parentId: null, stops: oneStop, madeBy: 'user' },
    })
    const otherOpinionId = await insertOpinion(testDb.db, {
      versionId: otherVersion.id,
      userId: owner.userId,
      reactions: ['must_go'],
    })

    // 새 일정은 저장돼야 한다 — 곁가지 정보 때문에 일정을 날리지 않는다
    const revised = await createVersion(tripId, {
      parentId: null,
      stops: oneStop,
      madeBy: 'ai',
      appliedOpinionIds: [otherOpinionId],
    })
    expect(revised.number).toBe(1)

    // 다른 여행의 의견에는 표시가 찍히지 않았다
    const untouched = await getOpinions(otherVersion.id)
    expect(untouched[0].appliedInVersionId ?? null).toBeNull()
    // 서버 로그에는 남는다
    expect(logged).toHaveBeenCalled()
    expect(JSON.stringify(logged.mock.calls)).toContain(otherOpinionId)
    logged.mockRestore()
  })

  it('섞여 와도 그 여행의 의견만 표시한다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { owner, groupId, tripId } = await tripFor()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, title: '다른 여행' })
    const mine = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    const theirs = await saveVersion({
      tripId: otherTripId,
      userId: owner.userId,
      input: { parentId: null, stops: oneStop, madeBy: 'user' },
    })
    const mineOpinion = await insertOpinion(testDb.db, { versionId: mine.id, userId: owner.userId, reactions: ['too_far'] })
    const theirOpinion = await insertOpinion(testDb.db, { versionId: theirs.id, userId: owner.userId, reactions: ['must_go'] })

    const revised = await createVersion(tripId, {
      parentId: mine.id,
      stops: oneStop,
      madeBy: 'ai',
      appliedOpinionIds: [mineOpinion, theirOpinion],
    })

    expect((await getOpinions(mine.id))[0].appliedInVersionId).toBe(revised.id)
    expect((await getOpinions(theirs.id))[0].appliedInVersionId ?? null).toBeNull()
    logged.mockRestore()
  })

  it('appliedOpinionIds를 안 주면 아무것도 바뀌지 않는다', async () => {
    const { owner, tripId } = await tripFor()
    const first = await saveVersion({ tripId, userId: owner.userId, input: { parentId: null, stops: oneStop, madeBy: 'user' } })
    await insertOpinion(testDb.db, { versionId: first.id, userId: owner.userId, reactions: ['too_far'] })

    await createVersion(tripId, { parentId: first.id, stops: oneStop, madeBy: 'ai' })
    expect((await getOpinions(first.id))[0].appliedInVersionId ?? null).toBeNull()
  })
})

describe('판정 요약 저장 (6단계)', () => {
  const mom = [traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })]
  const hanbatStops = [stop({ key: 's1', name: '한밭수목원', placeId: hanbat.id })]

  // 한밭수목원만 아는 가짜 장소·경로 (외부 TMAP을 부르지 않는다). 호출을 세어 볼 수 있다.
  function fakeGeo(getLegs: PlaceGeoDeps['getLegs'] = async () => []) {
    return {
      getPlaceDetails: vi.fn<PlaceGeoDeps['getPlaceDetails']>(async ids => (ids.includes(hanbat.id) ? [hanbat] : [])),
      getLegs: vi.fn<PlaceGeoDeps['getLegs']>(getLegs),
    }
  }

  it('여행자가 있으면 엔진 판정 요약을 함께 저장하고, 다시 읽어도 같다', async () => {
    const { owner, tripId } = await tripFor()
    await replaceTravelers({ tripId, travelers: mom })
    const geo = fakeGeo()

    const saved = await saveVersion(
      { tripId, userId: owner.userId, input: { parentId: null, stops: hanbatStops, madeBy: 'user' } },
      testDb.db,
      geo,
    )

    // 서버가 따로 계산하지 않는다 — 같은 입력으로 엔진을 돌린 결과와 똑같다
    const expected = summaryOf(await judgeStops({ stops: hanbatStops, travelers: await listTravelers(tripId) }, geo))
    expect(expected).not.toBeNull()
    expect(saved.summary).toEqual(expected)
    expect(saved.summary?.verdict).not.toBe('info') // 한밭수목원 안의 길을 안다
    expect(saved.summary?.day.high).toBeGreaterThan(0)

    const reread = await getVersion({ tripId, versionId: saved.id })
    expect(reread.summary).toEqual(expected)
  })

  it('createVersion(AI가 부르는 창구)도 같은 요약을 저장한다', async () => {
    const { owner, tripId } = await tripFor()
    await replaceTravelers({ tripId, travelers: mom })
    const geo = fakeGeo()

    const aiVersion = await createVersion(
      tripId,
      { parentId: null, stops: hanbatStops, madeBy: 'ai', madeByUserId: owner.userId },
      geo,
    )

    const expected = summaryOf(await judgeStops({ stops: hanbatStops, travelers: await listTravelers(tripId) }, geo))
    expect(aiVersion.summary).toEqual(expected)
  })

  it('여행자가 없으면 null이고 장소·경로를 묻지도 않는다', async () => {
    const { owner, tripId } = await tripFor()
    const geo = fakeGeo()

    const saved = await saveVersion(
      { tripId, userId: owner.userId, input: { parentId: null, stops: hanbatStops, madeBy: 'user' } },
      testDb.db,
      geo,
    )

    expect(saved.summary ?? null).toBeNull()
    expect(geo.getPlaceDetails).not.toHaveBeenCalled()
    expect(geo.getLegs).not.toHaveBeenCalled()
  })

  it('경로를 하나도 못 받아도 버전은 저장되고 요약은 정보 부족이다 (걷는 시간을 지어내지 않는다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { owner, tripId } = await tripFor()
    await replaceTravelers({ tripId, travelers: mom })
    // TMAP 키가 없어 경로를 하나도 못 받는 상황. 실제 껍데기(createPlaceGeoDeps)가 GeoError를 '경로 없음'으로 바꾼다.
    const failing = fakeGeo(async () => {
      throw new GeoError('missing_key', 'TMAP 키가 없어요')
    })
    // 장소 정보가 없는 두 곳 + 걸어가는 이동 → 경로 요청이 생긴다
    const stops = [
      stop({ key: 's1', name: '옛 시장', coord: [127.38, 36.35] }),
      stop({ key: 's2', name: '작은 카페', coord: [127.381, 36.351], arriveBy: 'walk' }),
    ]

    const saved = await saveVersion(
      { tripId, userId: owner.userId, input: { parentId: null, stops, madeBy: 'user' } },
      testDb.db,
      createPlaceGeoDeps(failing),
    )

    expect(saved.number).toBe(1) // 저장은 됐다
    expect(failing.getLegs).toHaveBeenCalledTimes(1)
    expect(saved.summary).toMatchObject({ verdict: 'info', day: { base: 0, high: 0 } })
    expect((await getVersion({ tripId, versionId: saved.id })).summary?.verdict).toBe('info')
    logged.mockRestore()
  })

  it('판정 중 오류가 나도 버전은 저장되고 요약만 null이다 (로그만 남긴다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { owner, tripId } = await tripFor()
    await replaceTravelers({ tripId, travelers: mom })
    const broken: PlaceGeoDeps = {
      getPlaceDetails: async () => {
        throw new Error('장소 DB 오류')
      },
      getLegs: async () => [],
    }

    const saved = await saveVersion(
      { tripId, userId: owner.userId, input: { parentId: null, stops: hanbatStops, madeBy: 'user' } },
      testDb.db,
      broken,
    )

    expect(saved.number).toBe(1)
    expect(saved.summary ?? null).toBeNull()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('이전 버전이 잘못되면 판정하기 전에 400이다 (불필요한 장소·경로 호출을 하지 않는다)', async () => {
    const { owner, tripId } = await tripFor()
    await replaceTravelers({ tripId, travelers: mom })
    const geo = fakeGeo()

    await expect(
      saveVersion(
        { tripId, userId: owner.userId, input: { parentId: 'no-such-version', stops: hanbatStops, madeBy: 'user' } },
        testDb.db,
        geo,
      ),
    ).rejects.toThrow('이전 버전을 찾을 수 없어요')
    expect(geo.getPlaceDetails).not.toHaveBeenCalled()
  })

  it('버전 목록·여행 목록·AI 문맥이 저장된 요약을 그대로 보여 준다 (배지가 읽는 곳)', async () => {
    const { owner, groupId, tripId } = await tripFor()
    await replaceTravelers({ tripId, travelers: mom })
    const saved = await saveVersion(
      { tripId, userId: owner.userId, input: { parentId: null, stops: hanbatStops, madeBy: 'user' } },
      testDb.db,
      fakeGeo(),
    )
    expect(saved.summary).not.toBeNull()

    expect((await listVersionSummaries(tripId))[0].summary).toEqual(saved.summary)
    expect((await listGroupTrips(groupId))[0].latestVersion?.summary).toEqual(saved.summary)
    expect((await getTripContext(tripId)).versions[0].summary).toEqual(saved.summary)
  })
})
