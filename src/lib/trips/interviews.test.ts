// 인터뷰 진행 상태 저장소(trip_interviews)가 김태형의 src/lib/ai/deps.ts의 InterviewStore 모양과 맞는지,
// 저장한 것을 그대로 꺼낼 수 있는지 본다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiDeps } from '@/lib/ai/deps'
import type { InterviewState } from '@/lib/contracts'
import { createGroup as insertGroup, insertTrip, signUp } from '@/lib/auth/test-fixtures'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { getInterview, interviews, saveInterview } from './interviews'

// 타입만으로 하는 검사 — 모양이 어긋나면 pnpm build(타입 검사)에서 걸린다.
const _interviews: AiDeps['interviews'] = interviews
void _interviews

let testDb: TestDb

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
}, 60_000)

beforeEach(async () => {
  await testDb.reset()
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

async function tripFor(): Promise<string> {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  return insertTrip(testDb.db, { groupId, createdBy: owner.userId })
}

function state(slot: InterviewState['cursor']['slot']): InterviewState {
  return {
    filled: { mode: 'scratch', travelers: [], styles: [], mustVisit: [], fixTargets: [] },
    cursor: { slot, travelerIndex: 0, questionIndex: 0 },
    history: [{ role: 'assistant', text: '누구와 가시나요?' }],
  }
}

describe('인터뷰 상태 저장소', () => {
  it('저장한 적 없으면 null', async () => {
    const tripId = await tripFor()
    expect(await getInterview(tripId)).toBeNull()
  })

  it('저장한 것을 그대로 꺼낸다', async () => {
    const tripId = await tripFor()
    await saveInterview(tripId, state('travelers'))
    expect(await getInterview(tripId)).toEqual(state('travelers'))
  })

  it('다시 저장하면 덮어쓴다 (여행당 한 줄)', async () => {
    const tripId = await tripFor()
    await saveInterview(tripId, state('travelers'))
    await saveInterview(tripId, state('date'))
    expect((await getInterview(tripId))?.cursor.slot).toBe('date')
  })

  it('여행마다 따로 저장된다', async () => {
    const a = await tripFor()
    const owner = await signUp({ name: '다른 사람', email: 'other@example.com' })
    const groupId = await insertGroup(testDb.db, { name: '다른 가족', ownerId: owner.userId })
    const b = await insertTrip(testDb.db, { groupId, createdBy: owner.userId })
    await saveInterview(a, state('date'))
    expect(await getInterview(b)).toBeNull()
  })

  it('모양이 어긋난 옛 상태는 null로 돌려준다 (처음부터 다시 시작)', async () => {
    const tripId = await tripFor()
    await testDb.db.execute(
      // 날 SQL로 일부러 깨진 jsonb를 넣는다
      (await import('drizzle-orm')).sql`insert into trip_interviews (trip_id, state) values (${tripId}, '{"old":true}'::jsonb)`,
    )
    expect(await getInterview(tripId)).toBeNull()
  })

  it('여행이 지워지면 상태도 함께 지워진다', async () => {
    const tripId = await tripFor()
    await saveInterview(tripId, state('date'))
    const { trips } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    await testDb.db.delete(trips).where(eq(trips.id, tripId))
    expect(await getInterview(tripId)).toBeNull()
  })
})
