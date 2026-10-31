// 초대 API 테스트. 토큰 규칙(7일 만료, 여러 명 사용, 만료 410, 이미 구성원이면 그대로 성공)을 고정한다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptInviteResponse, GroupDetail, InvitePreview } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  addMember,
  createGroup as insertGroup,
  insertExpiredInvite,
  jsonRequestWith,
  readBody,
  requestWith,
  routeParams,
  signUp,
} from '@/lib/auth/test-fixtures'
import { GET as getGroup } from '../groups/[id]/route'
import { POST as postInvite } from '../groups/[id]/invites/route'
import { GET as previewInvite } from './[token]/route'
import { POST as acceptInvite } from './[token]/accept/route'

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
  // 제한 시간 60초: 메모리 PGlite를 띄우는 데 1.6초쯤 걸리는데, 느린 컴퓨터나 CI에서는
  // vitest 기본값 5초를 넘겨 '초기화 시간 초과'로 실패한다 (이동주 제보).
  // vitest.config.ts는 공용 파일이라 건드리지 않고 이 파일에서만 늘린다.
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

// 그룹장과 그룹, 살아 있는 초대 토큰을 한 번에 준비한다
async function groupWithInvite() {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const response = await postInvite(
    jsonRequestWith({ method: 'POST', cookie: owner.cookie, path: `/api/groups/${groupId}/invites` }),
    routeParams({ id: groupId }),
  )
  const { token } = await readBody<{ token: string }>(response)
  return { owner, groupId, token }
}

const acceptRequest = (cookie?: string, body?: unknown) =>
  jsonRequestWith({ method: 'POST', cookie, body, path: '/api/invites/x/accept' })

describe('GET /api/invites/:token (미리보기)', () => {
  it('로그인 없이도 그룹 이름을 볼 수 있다', async () => {
    const { token } = await groupWithInvite()

    const response = await previewInvite(requestWith(), routeParams({ token }))
    expect(response.status).toBe(200)
    const body = await readBody<InvitePreview>(response)
    expect(body.groupName).toBe('우리 가족')
  })

  it('구성원 목록이나 그룹 id는 담기지 않는다 (권한 검사가 없는 API라서)', async () => {
    const { token, groupId } = await groupWithInvite()

    const body = await readBody<Record<string, unknown>>(await previewInvite(requestWith(), routeParams({ token })))
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'groupName'])
    expect(JSON.stringify(body)).not.toContain(groupId)
    expect(JSON.stringify(body)).not.toContain('김경선')
  })

  it('만료된 링크는 410', async () => {
    const { owner, groupId } = await groupWithInvite()
    const expired = await insertExpiredInvite(testDb.db, { groupId, createdBy: owner.userId })

    const response = await previewInvite(requestWith(), routeParams({ token: expired }))
    expect(response.status).toBe(410)
    const body = await readBody<{ error: { code: string } }>(response)
    expect(body.error.code).toBe('expired')
  })

  it('없는 토큰은 404 (만료와 구분해서 다른 안내를 띄울 수 있게)', async () => {
    const response = await previewInvite(requestWith(), routeParams({ token: 'no-such-token' }))
    expect(response.status).toBe(404)
  })
})

describe('POST /api/invites/:token/accept (참가)', () => {
  it('로그인하고 참가하면 구성원이 된다', async () => {
    const { token, groupId, owner } = await groupWithInvite()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })

    const response = await acceptInvite(acceptRequest(mom.cookie, { relation: '엄마' }), routeParams({ token }))
    expect(response.status).toBe(200)
    expect(await readBody<AcceptInviteResponse>(response)).toEqual({ groupId, alreadyMember: false })

    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members).toHaveLength(2)
    expect(group.members[1]).toMatchObject({ name: '엄마', role: 'member', relation: '엄마' })
  })

  it('관계를 안 보내도 참가된다 (relation은 선택)', async () => {
    const { token, groupId, owner } = await groupWithInvite()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })

    // 몸체를 아예 보내지 않는다
    expect((await acceptInvite(acceptRequest(mom.cookie), routeParams({ token }))).status).toBe(200)
    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members[1].relation).toBeNull()
  })

  it('relation을 null로 보내도 된다 (화면 폼이 쓰기 쉽게)', async () => {
    const { token } = await groupWithInvite()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    expect((await acceptInvite(acceptRequest(mom.cookie, { relation: null }), routeParams({ token }))).status).toBe(200)
  })

  it('한 링크로 여러 명이 참가할 수 있다', async () => {
    const { token, groupId, owner } = await groupWithInvite()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    const dad = await signUp({ name: '아빠', email: 'dad@example.com' })

    await acceptInvite(acceptRequest(mom.cookie, { relation: '엄마' }), routeParams({ token }))
    await acceptInvite(acceptRequest(dad.cookie, { relation: '아빠' }), routeParams({ token }))

    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members).toHaveLength(3)
  })

  it('이미 구성원이 다시 참가하면 그대로 성공하고 역할이 바뀌지 않는다', async () => {
    const { token, groupId, owner } = await groupWithInvite()

    // 그룹장이 자기 링크를 다시 누른 경우
    const response = await acceptInvite(acceptRequest(owner.cookie, { relation: '아들' }), routeParams({ token }))
    expect(response.status).toBe(200)
    expect(await readBody<AcceptInviteResponse>(response)).toEqual({ groupId, alreadyMember: true })

    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members).toHaveLength(1)
    expect(group.members[0].role).toBe('owner') // member로 떨어지지 않았다
    expect(group.members[0].relation).toBeNull() // relation도 덮어쓰지 않았다
  })

  it('이미 구성원인 member도 역할·관계가 그대로다', async () => {
    const { token, groupId, owner } = await groupWithInvite()
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member', relation: '아들' })

    await acceptInvite(acceptRequest(son.cookie, { relation: '며느리' }), routeParams({ token }))

    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members[1]).toMatchObject({ role: 'member', relation: '아들' })
  })

  it('로그인 안 하면 401 (미리보기는 되지만 참가는 안 된다)', async () => {
    const { token } = await groupWithInvite()
    expect((await acceptInvite(acceptRequest(undefined, {}), routeParams({ token }))).status).toBe(401)
  })

  it('만료된 링크로는 참가할 수 없다 (410)', async () => {
    const { owner, groupId } = await groupWithInvite()
    const expired = await insertExpiredInvite(testDb.db, { groupId, createdBy: owner.userId })
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })

    const response = await acceptInvite(acceptRequest(mom.cookie, {}), routeParams({ token: expired }))
    expect(response.status).toBe(410)
    // 구성원이 되지 않았다
    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members).toHaveLength(1)
  })

  it('없는 토큰은 404', async () => {
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    expect((await acceptInvite(acceptRequest(mom.cookie, {}), routeParams({ token: 'nope' }))).status).toBe(404)
  })

  it('관계가 너무 길면 400', async () => {
    const { token } = await groupWithInvite()
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    const response = await acceptInvite(acceptRequest(mom.cookie, { relation: '가'.repeat(21) }), routeParams({ token }))
    expect(response.status).toBe(400)
  })

  it('초대를 여러 번 만들면 예전 링크도 만료 전까지 쓸 수 있다', async () => {
    const { token: first, groupId, owner } = await groupWithInvite()
    const second = await readBody<{ token: string }>(
      await postInvite(
        jsonRequestWith({ method: 'POST', cookie: owner.cookie, path: `/api/groups/${groupId}/invites` }),
        routeParams({ id: groupId }),
      ),
    )
    expect(second.token).not.toBe(first)

    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    expect((await acceptInvite(acceptRequest(mom.cookie, {}), routeParams({ token: first }))).status).toBe(200)
  })
})
