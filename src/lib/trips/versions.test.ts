// 버전 번호 매기기와 AI 창구(createVersion·getOpinions)를 본다.
// 번호는 db.transaction()을 못 쓰는 상황에서 겹치지 않아야 하므로 여기서 집중해 확인한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiDeps } from '@/lib/ai/deps'
import { OpinionSchema } from '@/lib/contracts'
import { tripVersions } from '@/lib/db/schema'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { createGroup as insertGroup, insertOpinion, insertTrip, signUp, stop } from '@/lib/auth/test-fixtures'
import { createVersion, getVersion, listVersions, saveVersion } from './versions'
import { getOpinions } from './opinions'
import { getTripContext } from './context'

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
    expect(aiVersion.summary ?? null).toBeNull() // 판정 요약은 6단계
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
