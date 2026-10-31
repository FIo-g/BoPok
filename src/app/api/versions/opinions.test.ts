// 의견 API 테스트. 권한이 핵심이다 — 남의 그룹 403, 남의 의견 지우기 403,
// 그리고 '그룹에서 내보내진 사람은 자기 의견도 못 지운다'.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiErrorSchema, OpinionSchema } from '@/lib/contracts'
import type { Opinion } from '@/lib/contracts'
import { groupMembers } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
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
import { GET as listOpinions, POST as addOpinionRoute } from './[vid]/opinions/route'
import { DELETE as removeOpinionRoute } from '../opinions/[oid]/route'

const OpinionListSchema = z.array(OpinionSchema)

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

const addRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'POST', cookie, body, path: '/api/versions/x/opinions' })

const deleteRequest = (cookie?: string) =>
  jsonRequestWith({ method: 'DELETE', cookie, path: '/api/opinions/x' })

// 그룹장·엄마(구성원)·여행·버전 하나를 준비한다
async function versionWithFamily() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
  await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
  const version = await saveVersion({
    tripId,
    userId: owner.userId,
    input: { parentId: null, stops: [stop({ key: 's1', name: '한밭수목원' })], madeBy: 'user' },
  })
  return { owner, mom, groupId, tripId, version }
}

async function postOpinion(cookie: string, versionId: string, body: unknown): Promise<Opinion> {
  const response = await addOpinionRoute(addRequest(cookie, body), routeParams({ vid: versionId }))
  expect(response.status).toBe(200)
  return OpinionSchema.parse(await readBody(response))
}

describe('POST /api/versions/:vid/opinions (의견 남기기)', () => {
  it('구성원은 남길 수 있고 userName을 서버가 채운다', async () => {
    const { mom, version } = await versionWithFamily()

    const opinion = await postOpinion(mom.cookie, version.id, {
      stopKey: 's1',
      reactions: ['too_far', 'need_rest'],
      comment: '여기까지 걷기는 좀 멀어요',
    })
    expect(opinion).toMatchObject({
      versionId: version.id,
      stopKey: 's1',
      userId: mom.userId,
      userName: '엄마',
      reactions: ['too_far', 'need_rest'],
      comment: '여기까지 걷기는 좀 멀어요',
    })
    expect(opinion.appliedInVersionId ?? null).toBeNull()
  })

  it('일정 전체에 대한 의견은 stopKey가 null이다', async () => {
    const { mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, {
      stopKey: null,
      reactions: [],
      comment: '전체적으로 좋아요',
    })
    expect(opinion.stopKey).toBeNull()
  })

  it('이름을 몸체로 보내도 세션의 이름을 쓴다', async () => {
    const { mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, {
      stopKey: 's1',
      reactions: ['must_go'],
      userName: '사장님',
      userId: 'someone-else',
    })
    expect(opinion.userName).toBe('엄마')
    expect(opinion.userId).toBe(mom.userId)
  })

  it('반응도 글도 없으면 400 (계약이 빈 의견을 막는다)', async () => {
    const { mom, version } = await versionWithFamily()
    const response = await addOpinionRoute(
      addRequest(mom.cookie, { stopKey: 's1', reactions: [], comment: '' }),
      routeParams({ vid: version.id }),
    )
    expect(response.status).toBe(400)
  })

  it('글이 100자를 넘으면 400', async () => {
    const { mom, version } = await versionWithFamily()
    const response = await addOpinionRoute(
      addRequest(mom.cookie, { stopKey: 's1', reactions: [], comment: '가'.repeat(101) }),
      routeParams({ vid: version.id }),
    )
    expect(response.status).toBe(400)
  })

  it('다른 그룹 사람은 403', async () => {
    const { version } = await versionWithFamily()
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await addOpinionRoute(
      addRequest(stranger.cookie, { stopKey: 's1', reactions: ['must_go'] }),
      routeParams({ vid: version.id }),
    )
    expect(response.status).toBe(403)
    expect(ApiErrorSchema.parse(await readBody(response)).error.code).toBe('forbidden')
  })

  it('없는 버전은 404', async () => {
    const { mom } = await versionWithFamily()
    const response = await addOpinionRoute(
      addRequest(mom.cookie, { stopKey: null, reactions: ['must_go'] }),
      routeParams({ vid: 'no-such-version' }),
    )
    expect(response.status).toBe(404)
  })

  it('로그인 안 하면 401', async () => {
    const { version } = await versionWithFamily()
    const response = await addOpinionRoute(
      addRequest(undefined, { stopKey: null, reactions: ['must_go'] }),
      routeParams({ vid: version.id }),
    )
    expect(response.status).toBe(401)
  })
})

describe('GET /api/versions/:vid/opinions (의견 목록)', () => {
  it('오래된 것부터 나오고 가족 모두의 의견이 보인다', async () => {
    const { owner, mom, version } = await versionWithFamily()
    await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: ['too_far'] })
    await postOpinion(owner.cookie, version.id, { stopKey: null, reactions: [], comment: '좋아요' })

    const list = OpinionListSchema.parse(
      await readBody(await listOpinions(requestWith(mom.cookie), routeParams({ vid: version.id }))),
    )
    expect(list.map(one => one.userName)).toEqual(['엄마', '김경선'])
  })

  it('다른 그룹 사람은 403이고 본문에 의견 글이 없다', async () => {
    const { mom, version } = await versionWithFamily()
    await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: [], comment: '비밀 의견' })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await listOpinions(requestWith(stranger.cookie), routeParams({ vid: version.id }))
    expect(response.status).toBe(403)
    expect(JSON.stringify(await readBody(response))).not.toContain('비밀 의견')
  })

  it('로그인 안 하면 401', async () => {
    const { version } = await versionWithFamily()
    expect((await listOpinions(requestWith(), routeParams({ vid: version.id }))).status).toBe(401)
  })
})

describe('DELETE /api/opinions/:oid (내 의견 지우기)', () => {
  it('내 의견은 지워지고 목록에서 사라진다', async () => {
    const { mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: ['too_far'] })

    const response = await removeOpinionRoute(deleteRequest(mom.cookie), routeParams({ oid: opinion.id }))
    expect(response.status).toBe(200)

    const list = OpinionListSchema.parse(
      await readBody(await listOpinions(requestWith(mom.cookie), routeParams({ vid: version.id }))),
    )
    expect(list).toEqual([])
  })

  it('남의 의견은 403 "내 의견만 지울 수 있어요" (그룹장이라도 안 된다)', async () => {
    const { owner, mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: ['too_far'] })

    const response = await removeOpinionRoute(deleteRequest(owner.cookie), routeParams({ oid: opinion.id }))
    expect(response.status).toBe(403)
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('내 의견만 지울 수 있어요')

    // 지워지지 않았다
    const list = OpinionListSchema.parse(
      await readBody(await listOpinions(requestWith(mom.cookie), routeParams({ vid: version.id }))),
    )
    expect(list).toHaveLength(1)
  })

  it('그룹에서 내보내진 사람은 예전에 남긴 자기 의견도 지울 수 없다 (403)', async () => {
    const { groupId, mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: ['too_far'] })

    // 그룹장이 엄마를 내보낸다
    await testDb.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, mom.userId)))

    const response = await removeOpinionRoute(deleteRequest(mom.cookie), routeParams({ oid: opinion.id }))
    expect(response.status).toBe(403)
    // '내 의견만' 이전에 '구성원이 아니다'로 막힌다
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('이 여행에 접근할 수 없어요')
  })

  it('다른 그룹 사람은 403이고, 그 의견이 누구 것인지 알려 주지 않는다', async () => {
    const { mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: ['too_far'] })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })

    const response = await removeOpinionRoute(deleteRequest(stranger.cookie), routeParams({ oid: opinion.id }))
    expect(response.status).toBe(403)
    // 구성원인지를 먼저 보기 때문에 '내 의견만 지울 수 있어요'가 아니라 접근 거부가 나온다.
    // 순서가 뒤바뀌면 그 의견이 남의 것인지 여부가 남에게 새어 나간다.
    expect(ApiErrorSchema.parse(await readBody(response)).error.message).toBe('이 여행에 접근할 수 없어요')
  })

  it('없는 의견은 404', async () => {
    const { mom } = await versionWithFamily()
    const response = await removeOpinionRoute(deleteRequest(mom.cookie), routeParams({ oid: 'no-such-opinion' }))
    expect(response.status).toBe(404)
  })

  it('로그인 안 하면 401', async () => {
    const { mom, version } = await versionWithFamily()
    const opinion = await postOpinion(mom.cookie, version.id, { stopKey: 's1', reactions: ['too_far'] })
    expect((await removeOpinionRoute(deleteRequest(), routeParams({ oid: opinion.id }))).status).toBe(401)
  })
})
