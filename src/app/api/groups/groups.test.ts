// 그룹 API 권한 테스트. "남의 그룹 데이터가 보이면 가장 심각한 버그"(역할 문서)라서
// API마다 '남이 부르면 403'을 확인한다. route 함수를 직접 불러 권한·입력 검사·응답을 함께 본다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupDetail, GroupListResponse } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import {
  addMember,
  createGroup as insertGroup,
  jsonRequestWith,
  readBody,
  requestWith,
  routeParams,
  signUp,
} from '@/lib/auth/test-fixtures'
import { GET as getGroups, POST as postGroup } from './route'
import { GET as getGroup } from './[id]/route'
import { POST as postInvite } from './[id]/invites/route'
import { DELETE as deleteMember } from './[id]/members/[userId]/route'

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
})

beforeEach(async () => {
  await testDb.reset()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

const postGroupRequest = (cookie: string | undefined, body: unknown) =>
  jsonRequestWith({ method: 'POST', cookie, body, path: '/api/groups' })

describe('POST /api/groups (그룹 만들기)', () => {
  it('만든 사람이 그룹장이 되고, 바로 상세를 돌려준다', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })

    const response = await postGroup(postGroupRequest(me.cookie, { name: '우리 가족' }))
    expect(response.status).toBe(200)

    const group = await readBody<GroupDetail>(response)
    expect(group.name).toBe('우리 가족')
    expect(group.myRole).toBe('owner')
    expect(group.members).toEqual([
      expect.objectContaining({ userId: me.userId, userName: '김경선', role: 'owner', relation: null }),
    ])
  })

  it('로그인 안 하면 401', async () => {
    const response = await postGroup(postGroupRequest(undefined, { name: '우리 가족' }))
    expect(response.status).toBe(401)
  })

  it('빈 이름·공백만은 400', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })
    expect((await postGroup(postGroupRequest(me.cookie, { name: '' }))).status).toBe(400)
    expect((await postGroup(postGroupRequest(me.cookie, { name: '   ' }))).status).toBe(400)
  })

  it('역할을 owner로 올려 보내려 해도 무시된다', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })
    // 모르는 칸은 계약에서 버려진다 — 권한을 올릴 수 없다
    const response = await postGroup(postGroupRequest(me.cookie, { name: '우리 가족', role: 'owner', id: 'x' }))
    const group = await readBody<GroupDetail>(response)
    expect(group.id).not.toBe('x')
  })
})

describe('GET /api/groups (내 그룹 목록)', () => {
  it('내 그룹만 나온다 — 남의 그룹은 목록에 없다', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })
    const other = await signUp({ name: '남', email: 'other@example.com' })
    const mine = await insertGroup(testDb.db, { name: '우리 가족', ownerId: me.userId })
    await insertGroup(testDb.db, { name: '남의 가족', ownerId: other.userId })

    const body = await readBody<GroupListResponse>(await getGroups(requestWith(me.cookie)))
    expect(body.groups).toHaveLength(1)
    expect(body.groups[0]).toMatchObject({ id: mine, name: '우리 가족', myRole: 'owner', memberCount: 1 })
  })

  it('구성원이 늘면 memberCount도 늘고, 내 역할은 member로 나온다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member', relation: '아들' })

    const body = await readBody<GroupListResponse>(await getGroups(requestWith(son.cookie)))
    expect(body.groups[0]).toMatchObject({ myRole: 'member', memberCount: 2 })
  })

  it('속한 그룹이 없으면 빈 목록', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })
    const body = await readBody<GroupListResponse>(await getGroups(requestWith(me.cookie)))
    expect(body.groups).toEqual([])
  })

  it('로그인 안 하면 401', async () => {
    expect((await getGroups(requestWith())).status).toBe(401)
  })
})

describe('GET /api/groups/:id (그룹 상세)', () => {
  it('구성원은 볼 수 있고 myRole이 들어 있다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member', relation: '엄마' })

    const group = await readBody<GroupDetail>(await getGroup(requestWith(mom.cookie), routeParams({ id: groupId })))
    expect(group.myRole).toBe('member')
    expect(group.members).toHaveLength(2)
    expect(group.members.map(member => member.userName)).toEqual(['김경선', '엄마'])
  })

  it('다른 그룹 사람은 403이고 본문에 그룹 정보가 없다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    const response = await getGroup(requestWith(stranger.cookie), routeParams({ id: groupId }))
    expect(response.status).toBe(403)
    const text = JSON.stringify(await readBody(response))
    expect(text).not.toContain('우리 가족')
    expect(text).not.toContain('김경선')
  })

  it('없는 그룹도 403 (404로 나누면 그룹이 있다는 사실이 새어 나간다)', async () => {
    const me = await signUp({ name: '김경선', email: 'gs@example.com' })
    const response = await getGroup(requestWith(me.cookie), routeParams({ id: 'no-such-group' }))
    expect(response.status).toBe(403)
  })

  it('로그인 안 하면 401', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    expect((await getGroup(requestWith(), routeParams({ id: groupId }))).status).toBe(401)
  })
})

describe('POST /api/groups/:id/invites (초대 링크 만들기)', () => {
  const inviteRequest = (cookie?: string) =>
    jsonRequestWith({ method: 'POST', cookie, path: '/api/groups/x/invites' })

  it('그룹장은 만들 수 있다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    const response = await postInvite(inviteRequest(owner.cookie), routeParams({ id: groupId }))
    expect(response.status).toBe(200)
    const body = await readBody<{ token: string; expiresAt: string }>(response)
    expect(body.token).toHaveLength(43) // 32바이트 base64url
    // 7일 뒤 (하루 오차 안에서)
    const days = (new Date(body.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('그냥 구성원은 403 (그룹장만 할 수 있다)', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    expect((await postInvite(inviteRequest(son.cookie), routeParams({ id: groupId }))).status).toBe(403)
  })

  it('다른 그룹 사람은 403', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    expect((await postInvite(inviteRequest(stranger.cookie), routeParams({ id: groupId }))).status).toBe(403)
  })

  it('로그인 안 하면 401', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    expect((await postInvite(inviteRequest(), routeParams({ id: groupId }))).status).toBe(401)
  })
})

describe('DELETE /api/groups/:id/members/:userId (내보내기)', () => {
  const deleteRequest = (cookie?: string) =>
    jsonRequestWith({ method: 'DELETE', cookie, path: '/api/groups/x/members/y' })

  it('그룹장은 구성원을 내보낼 수 있고, 내보낸 사람은 더 이상 못 본다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    const response = await deleteMember(deleteRequest(owner.cookie), routeParams({ id: groupId, userId: son.userId }))
    expect(response.status).toBe(200)

    // 접근이 실제로 끊겼는지
    expect((await getGroup(requestWith(son.cookie), routeParams({ id: groupId }))).status).toBe(403)
    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members).toHaveLength(1)
  })

  it('그룹장이 자기 자신을 내보내려 하면 400', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    const response = await deleteMember(
      deleteRequest(owner.cookie),
      routeParams({ id: groupId, userId: owner.userId }),
    )
    expect(response.status).toBe(400)
    // 아무도 내보내지지 않았다 — 그룹장은 그대로 있다
    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members).toHaveLength(1)
    expect(group.members[0].role).toBe('owner')
  })

  it('어떤 내보내기 뒤에도 그룹에는 그룹장이 최소 1명 있다', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    await deleteMember(deleteRequest(owner.cookie), routeParams({ id: groupId, userId: son.userId }))
    await deleteMember(deleteRequest(owner.cookie), routeParams({ id: groupId, userId: owner.userId }))

    const group = await readBody<GroupDetail>(await getGroup(requestWith(owner.cookie), routeParams({ id: groupId })))
    expect(group.members.filter(member => member.role === 'owner')).toHaveLength(1)
  })

  it('그룹에 없는 사람을 내보내려 하면 404', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })

    const response = await deleteMember(deleteRequest(owner.cookie), routeParams({ id: groupId, userId: 'nobody' }))
    expect(response.status).toBe(404)
  })

  it('그냥 구성원이 누군가를 내보내려 하면 403', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    const mom = await signUp({ name: '엄마', email: 'mom@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })
    await addMember(testDb.db, { groupId, userId: mom.userId, role: 'member' })

    const response = await deleteMember(deleteRequest(son.cookie), routeParams({ id: groupId, userId: mom.userId }))
    expect(response.status).toBe(403)
  })

  it('다른 그룹 사람이 내보내려 하면 403', async () => {
    const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
    const son = await signUp({ name: '아들', email: 'son@example.com' })
    const stranger = await signUp({ name: '남', email: 'stranger@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
    await addMember(testDb.db, { groupId, userId: son.userId, role: 'member' })

    const response = await deleteMember(deleteRequest(stranger.cookie), routeParams({ id: groupId, userId: son.userId }))
    expect(response.status).toBe(403)
  })
})
