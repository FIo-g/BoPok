// getTripContext·saveTravelers·requireTripMember가 김태형의 src/lib/ai/deps.ts 모양과 맞는지 본다.
// 모양이 어긋나면 태형님이 가짜(dev-deps)를 진짜로 바꿀 때 터지므로, 여기서 먼저 걸리게 해 둔다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiDeps } from '@/lib/ai/deps'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { addMember, createGroup as insertGroup, insertTrip, signUp, traveler } from '@/lib/auth/test-fixtures'
import { removeMember } from '@/lib/groups'
import { requireTripMember } from './access'
import { getTripContext } from './context'
import { replaceTravelers, saveTravelers } from './travelers'

// 타입만으로 하는 검사 — 모양이 어긋나면 pnpm build(타입 검사)에서 걸린다.
const _getTripContext: AiDeps['getTripContext'] = getTripContext
const _saveTravelers: AiDeps['saveTravelers'] = saveTravelers
const _requireTripMember: AiDeps['requireTripMember'] = requireTripMember
void _getTripContext
void _saveTravelers
void _requireTripMember

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

async function tripFor(mode: 'paste' | 'scratch' = 'scratch') {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, mode })
  return { owner, groupId, tripId }
}

describe('getTripContext', () => {
  it('AI가 필요한 칸만 돌려준다 (id, groupId, startMode)', async () => {
    const { groupId, tripId } = await tripFor('paste')

    const context = await getTripContext(tripId)
    expect(context.trip).toEqual({ id: tripId, groupId, startMode: 'paste' })
    expect(Object.keys(context).sort()).toEqual(['travelers', 'trip', 'versions'])
  })

  it('여행자는 저장한 순서대로 들어 있다', async () => {
    const { tripId } = await tripFor()
    await replaceTravelers({
      tripId,
      travelers: [
        traveler({ id: 't1', label: '엄마', isParent: true, condition: { continuousMin: 20 } }),
        traveler({ id: 't2', label: '나' }),
      ],
    })

    const context = await getTripContext(tripId)
    expect(context.travelers.map(one => one.label)).toEqual(['엄마', '나'])
    expect(context.travelers[0].condition).toEqual({ continuousMin: 20 })
  })

  it('versions는 4단계까지 빈 배열이다 (AI가 "이전 버전 없음"으로 본다)', async () => {
    const { tripId } = await tripFor()
    await expect(getTripContext(tripId)).resolves.toMatchObject({ versions: [] })
  })

  it('없는 여행은 404', async () => {
    await tripFor()
    await expect(getTripContext('no-such-trip')).rejects.toThrow('여행을 찾을 수 없어요')
  })
})

describe('saveTravelers (AI 인터뷰가 채운 여행자 저장)', () => {
  it('저장되고 아무것도 돌려주지 않는다 (deps 모양)', async () => {
    const { tripId } = await tripFor()

    await expect(
      saveTravelers(tripId, [traveler({ id: 't1', label: '엄마', isParent: true })]),
    ).resolves.toBeUndefined()

    const context = await getTripContext(tripId)
    expect(context.travelers).toHaveLength(1)
    expect(context.travelers[0]).toMatchObject({ label: '엄마', isParent: true })
  })

  it('AI가 보낸 filledBySelf는 믿지 않는다 (고치는 사람이 없으므로 false)', async () => {
    const { owner, tripId } = await tripFor()

    await saveTravelers(tripId, [traveler({ id: 't1', label: '나', userId: owner.userId, filledBySelf: true })])

    const context = await getTripContext(tripId)
    expect(context.travelers[0].filledBySelf).toBe(false)
  })

  it("이름표가 '나'이면 여행을 만든 사람을 연결하고 filledBySelf를 true로 한다", async () => {
    const { owner, tripId } = await tripFor()

    // 인터뷰에 답한 사람은 여행을 만든 사람이다
    await saveTravelers(tripId, [
      traveler({ id: 't1', label: '엄마', isParent: true, age: 68 }),
      traveler({ id: 't2', label: '나', pace: 'normal' }),
    ])

    const context = await getTripContext(tripId)
    const me = context.travelers.find(one => one.label === '나')
    expect(me?.userId).toBe(owner.userId)
    expect(me?.filledBySelf).toBe(true)
    // 다른 사람은 연결되지 않고 filledBySelf도 false다
    const mom = context.travelers.find(one => one.label === '엄마')
    expect(mom?.userId).toBeUndefined()
    expect(mom?.filledBySelf).toBe(false)
  })

  it("'나'가 없으면 아무도 연결하지 않는다", async () => {
    const { tripId } = await tripFor()
    await saveTravelers(tripId, [traveler({ id: 't1', label: '엄마', isParent: true })])

    const context = await getTripContext(tripId)
    expect(context.travelers[0].userId).toBeUndefined()
    expect(context.travelers[0].filledBySelf).toBe(false)
  })

  it('만든 사람이 이미 다른 여행자에 연결돼 있으면 "나"에 또 넣지 않는다', async () => {
    const { owner, tripId } = await tripFor()
    // 먼저 '아빠' 칸에 만든 사람이 연결돼 있다
    await replaceTravelers({
      tripId,
      travelers: [traveler({ id: 't0', label: '아빠', userId: owner.userId })],
      actorUserId: owner.userId,
    })

    await saveTravelers(tripId, [
      traveler({ id: 't0', label: '아빠', userId: owner.userId }),
      traveler({ id: 't2', label: '나' }),
    ])

    const context = await getTripContext(tripId)
    expect(context.travelers.find(one => one.label === '아빠')?.userId).toBe(owner.userId)
    // '나'는 연결되지 않는다 — 한 계정은 한 사람과만 연결된다
    expect(context.travelers.find(one => one.label === '나')?.userId).toBeUndefined()
  })

  it("만든 사람이 그룹을 떠났으면 '나'에 연결하지 않고 저장은 성공한다", async () => {
    const { owner, groupId, tripId } = await tripFor()
    // 그룹장이 0명이 되는 내보내기는 막혀 있어서, 다른 그룹장을 먼저 세우고 만든 사람을 내보낸다
    const dad = await signUp({ name: '아빠', email: 'dad@example.com' })
    await addMember(testDb.db, { groupId, userId: dad.userId, role: 'owner' })
    await removeMember({ groupId, targetUserId: owner.userId, actorUserId: dad.userId })

    // 연결을 걸면 구성원이 아닌 계정이라 400으로 인터뷰 결과가 통째로 날아갔다
    await expect(
      saveTravelers(tripId, [
        traveler({ id: 't1', label: '엄마', isParent: true, age: 68 }),
        traveler({ id: 't2', label: '나', pace: 'normal' }),
      ]),
    ).resolves.toBeUndefined()

    const context = await getTripContext(tripId)
    expect(context.travelers.map(one => one.label)).toEqual(['엄마', '나'])
    const me = context.travelers.find(one => one.label === '나')
    expect(me?.userId).toBeUndefined() // 떠난 사람은 연결하지 않는다
    expect(me?.filledBySelf).toBe(false) // 직접 답했다고 말할 근거가 없다
    expect(me?.pace).toBe('normal') // 인터뷰가 채운 값은 그대로 저장된다
  })

  it('만든 사람이 그룹에 남아 있으면 지금처럼 연결한다 (떠난 사람 처리가 평소 동작을 바꾸지 않는다)', async () => {
    const { owner, groupId, tripId } = await tripFor()
    const dad = await signUp({ name: '아빠', email: 'dad@example.com' })
    await addMember(testDb.db, { groupId, userId: dad.userId, role: 'member' })
    // 다른 구성원이 떠나도 만든 사람은 그대로 구성원이다
    await removeMember({ groupId, targetUserId: dad.userId, actorUserId: owner.userId })

    await saveTravelers(tripId, [traveler({ id: 't1', label: '나' })])

    const context = await getTripContext(tripId)
    expect(context.travelers[0].userId).toBe(owner.userId)
    expect(context.travelers[0].filledBySelf).toBe(true)
  })

  it('AI가 보낸 계정 연결은 걸지 않고 버린다 (로그만 남긴다)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { tripId } = await tripFor()
    const outsider = await signUp({ name: '남', email: 'outsider@example.com' })

    // 인터뷰 결과를 통째로 날리지 않고 연결만 버린다 — '내 연결만 걸 수 있다'에서 '나'가 없는 길이다
    await saveTravelers(tripId, [traveler({ id: 't1', label: '남', userId: outsider.userId })])

    const context = await getTripContext(tripId)
    expect(context.travelers[0].userId).toBeUndefined()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
