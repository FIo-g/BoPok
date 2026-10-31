// getTripContext·saveTravelers·requireTripMember가 김태형의 src/lib/ai/deps.ts 모양과 맞는지 본다.
// 모양이 어긋나면 태형님이 가짜(dev-deps)를 진짜로 바꿀 때 터지므로, 여기서 먼저 걸리게 해 둔다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiDeps } from '@/lib/ai/deps'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { createGroup as insertGroup, insertTrip, signUp, traveler } from '@/lib/auth/test-fixtures'
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

  it('그룹 밖 계정을 연결하려 하면 막는다', async () => {
    const { tripId } = await tripFor()
    const outsider = await signUp({ name: '남', email: 'outsider@example.com' })

    await expect(
      saveTravelers(tripId, [traveler({ id: 't1', label: '남', userId: outsider.userId })]),
    ).rejects.toThrow('그룹 구성원이 아닌 계정')
  })
})
