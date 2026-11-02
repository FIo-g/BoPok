// 건강 정보 저장·읽기·권한·지우기와 여행자 운동 횟수 칸을 본다 (PGlite 메모리 DB).
// 가장 중요한 것: "본인만"이 다른 가족에게 새지 않는 것, 남이 고치지 못하는 것.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DietRule, TravelerHealthInput } from '@/lib/contracts'
import { TravelerHealthSchema } from '@/lib/contracts'
import { HttpError } from '@/lib/auth/http'
import { addMember, createGroup as insertGroup, insertTrip, insertUser, traveler } from '@/lib/auth/test-fixtures'
import { tripTravelerHealth, trips } from '@/lib/db/schema'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { listTravelers, patchTraveler, replaceTravelers } from '@/lib/trips'
import { eq } from 'drizzle-orm'
import { avoidFoodTagsForTrip, deleteHealth, deleteHealthExcept, listVisibleHealth, putHealth } from './health'

// 규칙 표(DIET_RULES)는 Task 2에서 채워지는 사람이 만든 표다. 여기서는 모양만 갖춘 가짜 규칙으로
// "일행 전체에서 태그만 모은다"는 동작을 본다.
// vi.mock은 파일 맨 위로 끌어올려지므로, 쓰는 값도 vi.hoisted로 같이 끌어올린다.
const TEST_RULES = vi.hoisted((): readonly DietRule[] => [
  {
    id: 'test-diabetes-sugary',
    reasonKind: 'condition',
    condition: 'diabetes',
    foodTag: 'sugary',
    sentence: '시험용 문장 1',
    source: '시험용 출처',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
  {
    id: 'test-warfarin-leafy',
    reasonKind: 'medication',
    medicationClass: 'warfarin',
    foodTag: 'leafy_greens',
    sentence: '시험용 문장 2',
    source: '시험용 출처',
    checkedAt: '2026-11-02',
    confidence: 'A',
  },
])

vi.mock('@/lib/engine', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/engine')>()
  // AI 경로는 AI_AVOID_RULES(실제 표에서 몇 줄을 뺀 것)를 쓰므로 같은 가짜 표로 바꿔 둔다
  return { ...original, DIET_RULES: TEST_RULES, AI_AVOID_RULES: TEST_RULES }
})

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
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

const MOM = 'u-mom' // 계정이 있는 여행자 '엄마'의 계정
const SON = 'u-son' // 그룹 구성원 (계정이 연결된 여행자는 없다)
const OWNER = 'u-owner' // 여행을 만든 사람

const input = (patch: Partial<TravelerHealthInput> = {}): TravelerHealthInput => ({
  conditions: ['diabetes'],
  medicationClasses: [],
  visibility: 'group',
  consent: true,
  ...patch,
})

// 엄마(t1, 계정 연결) · 할머니(t2, 계정 없음) · 나(t3, 계정 없음). 구성원은 owner·엄마·아들.
async function setup() {
  for (const [id, name] of [
    [OWNER, '김경선'],
    [MOM, '엄마'],
    [SON, '아들'],
  ]) {
    await insertUser(testDb.db, { id, name, email: `${id}@example.com` })
  }
  const groupId = await insertGroup(testDb.db, { name: '우리 가족', ownerId: OWNER })
  await addMember(testDb.db, { groupId, userId: MOM, role: 'member' })
  await addMember(testDb.db, { groupId, userId: SON, role: 'member' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: OWNER })

  // 엄마의 계정 연결은 엄마 본인만 걸 수 있다
  await replaceTravelers(
    {
      tripId,
      actorUserId: MOM,
      travelers: [
        traveler({ id: 't1', label: '엄마', userId: MOM, isParent: true }),
        traveler({ id: 't2', label: '할머니', isParent: true }),
        traveler({ id: 't3', label: '나' }),
      ],
    },
    testDb.db,
  )
  return { groupId, tripId }
}

const put = (tripId: string, travelerId: string, actorUserId: string, patch: Partial<TravelerHealthInput> = {}) =>
  putHealth({ tripId, travelerId, actorUserId, input: input(patch) }, testDb.db)

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (error) {
    if (error instanceof HttpError) return error.status
    throw error
  }
}

describe('저장하고 읽기', () => {
  it('저장한 건강 정보를 계약 모양 그대로 돌려주고, 서버 시각을 동의 날짜로 찍는다', async () => {
    const { tripId } = await setup()

    const before = Date.now()
    const saved = await put(tripId, 't2', OWNER, { conditions: ['diabetes', 'gout'], medicationClasses: ['warfarin'] })
    const after = Date.now()

    expect(TravelerHealthSchema.parse(saved)).toEqual(saved)
    expect(saved).toMatchObject({
      tripId,
      travelerId: 't2',
      conditions: ['diabetes', 'gout'],
      medicationClasses: ['warfarin'],
      visibility: 'group',
      enteredByUserId: OWNER,
    })
    const consentMs = Date.parse(saved.consentAt)
    expect(consentMs).toBeGreaterThanOrEqual(before)
    expect(consentMs).toBeLessThanOrEqual(after)

    expect(await listVisibleHealth(tripId, OWNER, testDb.db)).toEqual([saved])
  })

  it('다시 저장하면 값과 동의 날짜는 바뀌고 첫 입력자는 그대로다', async () => {
    const { tripId } = await setup()
    const first = await put(tripId, 't2', OWNER)

    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await put(tripId, 't2', OWNER, { conditions: ['hypertension'], visibility: 'self' })

    expect(second.conditions).toEqual(['hypertension'])
    expect(second.visibility).toBe('self')
    expect(second.enteredByUserId).toBe(OWNER)
    expect(Date.parse(second.consentAt)).toBeGreaterThan(Date.parse(first.consentAt))
    expect(await listVisibleHealth(tripId, OWNER, testDb.db)).toEqual([second])
  })

  it('여행이 달라도 같은 여행자 id(t1)가 섞이지 않는다', async () => {
    const { groupId, tripId } = await setup()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: OWNER, title: '다른 여행' })
    await replaceTravelers({ tripId: otherTripId, travelers: [traveler({ id: 't1', label: '할머니' })] }, testDb.db)

    await put(tripId, 't2', OWNER, { conditions: ['gout'] })
    await put(otherTripId, 't1', OWNER, { conditions: ['kidney_disease'] })

    expect((await listVisibleHealth(tripId, OWNER, testDb.db)).map(one => one.conditions)).toEqual([['gout']])
    expect((await listVisibleHealth(otherTripId, OWNER, testDb.db)).map(one => one.conditions)).toEqual([['kidney_disease']])
  })

  it('여행자 순서대로 돌려준다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't3', OWNER, { conditions: ['gout'] })
    await put(tripId, 't2', OWNER, { conditions: ['diabetes'] })

    expect((await listVisibleHealth(tripId, OWNER, testDb.db)).map(one => one.travelerId)).toEqual(['t2', 't3'])
  })
})

describe('보이는 범위', () => {
  it('가족 모두: 다른 구성원도 본다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't2', OWNER, { visibility: 'group' })

    expect(await listVisibleHealth(tripId, SON, testDb.db)).toHaveLength(1)
    expect(await listVisibleHealth(tripId, MOM, testDb.db)).toHaveLength(1)
  })

  it('본인만, 계정 없는 여행자: 대신 입력한 사람만 본다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't2', OWNER, { visibility: 'self' })

    expect(await listVisibleHealth(tripId, OWNER, testDb.db)).toHaveLength(1)
    expect(await listVisibleHealth(tripId, SON, testDb.db)).toEqual([])
    expect(await listVisibleHealth(tripId, MOM, testDb.db)).toEqual([])
  })

  it('본인만, 계정 있는 여행자: 그 계정만 본다 (대신 입력한 사람도 못 본다)', async () => {
    const { tripId } = await setup()
    // 계정이 연결되기 전에 아들이 대신 넣어 둔 기록을 흉내 낸다
    await testDb.db.insert(tripTravelerHealth).values({
      tripId,
      travelerId: 't1',
      conditions: ['heart_disease'],
      medicationClasses: [],
      visibility: 'self',
      consentAt: new Date(),
      enteredByUserId: SON,
    })

    expect(await listVisibleHealth(tripId, MOM, testDb.db)).toHaveLength(1)
    expect(await listVisibleHealth(tripId, SON, testDb.db)).toEqual([])
    expect(await listVisibleHealth(tripId, OWNER, testDb.db)).toEqual([])
  })

  it('여행자 목록에서 빠진 사람의 남은 기록은 가족 모두여도 돌려주지 않는다', async () => {
    const { tripId } = await setup()
    await testDb.db.insert(tripTravelerHealth).values({
      tripId,
      travelerId: 'gone',
      conditions: ['gout'],
      medicationClasses: [],
      visibility: 'group',
      consentAt: new Date(),
      enteredByUserId: OWNER,
    })

    expect(await listVisibleHealth(tripId, OWNER, testDb.db)).toEqual([])
  })
})

describe('고칠 수 있는 사람', () => {
  it('계정 있는 여행자(엄마)는 본인만 고친다 — 아들이 넣거나 지우려 하면 403', async () => {
    const { tripId } = await setup()

    expect(await statusOf(put(tripId, 't1', SON))).toBe(403)
    expect(await statusOf(put(tripId, 't1', OWNER))).toBe(403)
    expect(await statusOf(put(tripId, 't1', MOM))).toBe('ok')

    expect(await statusOf(deleteHealth({ tripId, travelerId: 't1', actorUserId: SON }, testDb.db))).toBe(403)
    expect(await listVisibleHealth(tripId, MOM, testDb.db)).toHaveLength(1)
  })

  it('계정 없는 여행자는 처음 넣은 사람만 고친다. 처음 넣기는 구성원 누구나 할 수 있다', async () => {
    const { tripId } = await setup()

    expect(await statusOf(put(tripId, 't2', SON))).toBe('ok')
    expect(await statusOf(put(tripId, 't2', OWNER))).toBe(403)
    expect(await statusOf(put(tripId, 't2', SON, { conditions: ['gout'] }))).toBe('ok')
    expect(await statusOf(deleteHealth({ tripId, travelerId: 't2', actorUserId: OWNER }, testDb.db))).toBe(403)

    const [only] = await listVisibleHealth(tripId, SON, testDb.db)
    expect(only).toMatchObject({ conditions: ['gout'], enteredByUserId: SON })
  })

  it('나중에 계정이 연결되면 첫 입력자는 그대로 두고 연결된 본인이 고친다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't3', SON) // 아들이 '나'(t3)를 대신 넣었다

    await replaceTravelers(
      {
        tripId,
        actorUserId: SON,
        travelers: [
          traveler({ id: 't1', label: '엄마', userId: MOM, isParent: true }),
          traveler({ id: 't2', label: '할머니', isParent: true }),
          traveler({ id: 't3', label: '나', userId: SON }),
        ],
      },
      testDb.db,
    )

    expect(await statusOf(put(tripId, 't3', OWNER))).toBe(403)
    const updated = await put(tripId, 't3', SON, { conditions: ['hypertension'] })
    expect(updated.enteredByUserId).toBe(SON)
  })

  it('여행자가 없으면 404', async () => {
    const { tripId } = await setup()

    expect(await statusOf(put(tripId, 'nobody', OWNER))).toBe(404)
    expect(await statusOf(deleteHealth({ tripId, travelerId: 'nobody', actorUserId: OWNER }, testDb.db))).toBe(404)
    expect(await statusOf(put('no-such-trip', 't1', OWNER))).toBe(404)
  })
})

describe('지우기 (동의 철회)', () => {
  it('지우면 바로 사라지고, 없는 것을 지워도 조용히 끝난다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't2', OWNER)

    await deleteHealth({ tripId, travelerId: 't2', actorUserId: OWNER }, testDb.db)
    expect(await listVisibleHealth(tripId, OWNER, testDb.db)).toEqual([])

    expect(await statusOf(deleteHealth({ tripId, travelerId: 't2', actorUserId: OWNER }, testDb.db))).toBe('ok')
  })

  it('여행자 목록을 저장할 때 빠진 사람의 건강 정보도 함께 지워진다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't2', OWNER, { conditions: ['gout'] })
    await put(tripId, 't3', OWNER, { conditions: ['diabetes'] })

    await replaceTravelers(
      {
        tripId,
        travelers: [traveler({ id: 't1', label: '엄마', userId: MOM, isParent: true }), traveler({ id: 't3', label: '나' })],
      },
      testDb.db,
    )

    const rows = await testDb.db.select().from(tripTravelerHealth).where(eq(tripTravelerHealth.tripId, tripId))
    expect(rows.map(row => row.travelerId)).toEqual(['t3'])
  })

  it('목록을 비워 저장하면 그 여행의 건강 정보가 모두 지워지고, 다른 여행 것은 그대로다', async () => {
    const { groupId, tripId } = await setup()
    const otherTripId = await insertTrip(testDb.db, { groupId, createdBy: OWNER, title: '다른 여행' })
    await replaceTravelers({ tripId: otherTripId, travelers: [traveler({ id: 't2', label: '할머니' })] }, testDb.db)
    await put(tripId, 't2', OWNER)
    await put(otherTripId, 't2', OWNER)

    await deleteHealthExcept(tripId, [], testDb.db)

    const rows = await testDb.db.select().from(tripTravelerHealth)
    expect(rows.map(row => row.tripId)).toEqual([otherTripId])
  })

  it('여행이 지워지면 건강 정보도 함께 지워진다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't2', OWNER)

    await testDb.db.delete(trips).where(eq(trips.id, tripId))

    expect(await testDb.db.select().from(tripTravelerHealth)).toEqual([])
  })
})

describe('AI에 넘기는 음식 태그', () => {
  it('보이는 범위와 상관없이 일행 전체의 병·약에서 태그만 모은다', async () => {
    const { tripId } = await setup()
    await put(tripId, 't2', OWNER, { conditions: ['diabetes'], visibility: 'self' })
    await put(tripId, 't3', SON, { conditions: [], medicationClasses: ['warfarin'], visibility: 'self' })

    // 아무도 서로의 기록을 볼 수 없는 상태에서도 태그에는 둘 다 들어간다 (이유는 AI에 가지 않는다)
    expect(await listVisibleHealth(tripId, MOM, testDb.db)).toEqual([])
    expect(await avoidFoodTagsForTrip(tripId, testDb.db)).toEqual(['leafy_greens', 'sugary'])
  })

  it('건강 정보가 없으면 빈 목록이다', async () => {
    const { tripId } = await setup()

    expect(await avoidFoodTagsForTrip(tripId, testDb.db)).toEqual([])
  })

  it('여행자 목록에서 빠진 사람의 남은 기록은 태그에 넣지 않는다', async () => {
    const { tripId } = await setup()
    await testDb.db.insert(tripTravelerHealth).values({
      tripId,
      travelerId: 'gone',
      conditions: ['diabetes'],
      medicationClasses: [],
      visibility: 'group',
      consentAt: new Date(),
      enteredByUserId: OWNER,
    })

    expect(await avoidFoodTagsForTrip(tripId, testDb.db)).toEqual([])
  })
})

describe('운동 횟수 칸 (exerciseFrequency)', () => {
  it('저장하고 읽으면 그대로 나오고, 비운 여행자에는 칸 자체가 없다', async () => {
    const { tripId } = await setup()

    const saved = await replaceTravelers(
      {
        tripId,
        actorUserId: MOM,
        travelers: [
          traveler({ id: 't1', label: '엄마', userId: MOM, isParent: true, exerciseFrequency: 'three_four' }),
          traveler({ id: 't2', label: '할머니', isParent: true }),
        ],
      },
      testDb.db,
    )

    expect(saved[0].exerciseFrequency).toBe('three_four')
    expect(saved[1].exerciseFrequency).toBeUndefined()

    const listed = await listTravelers(tripId, testDb.db)
    expect(listed.map(one => one.exerciseFrequency)).toEqual(['three_four', undefined])
  })

  // HTTP PATCH로는 비울 수 없다: JSON에는 undefined가 없고 계약(PatchTravelerRequestSchema)이 null을 받지 않는다.
  // 화면은 목록 저장(PUT)으로 비운다. 여기서는 서버 함수가 "칸이 있으면 바꾸고, 없으면 그대로"인지만 본다.
  it('patchTraveler 함수는 칸이 있으면 바꾸고(undefined면 비우고), 칸이 없으면 그대로 둔다', async () => {
    const { tripId } = await setup()

    const set = await patchTraveler({ tripId, travelerId: 't2', patch: { exerciseFrequency: 'rarely' } }, testDb.db)
    expect(set.exerciseFrequency).toBe('rarely')

    // 칸을 보내지 않은 PATCH는 값을 건드리지 않는다
    const kept = await patchTraveler({ tripId, travelerId: 't2', patch: { label: '외할머니' } }, testDb.db)
    expect(kept.exerciseFrequency).toBe('rarely')

    const cleared = await patchTraveler({ tripId, travelerId: 't2', patch: { exerciseFrequency: undefined } }, testDb.db)
    expect(cleared.exerciseFrequency).toBeUndefined()
  })

  it('운동 횟수만 바뀌어도 본인이 직접 채웠다고 보지 않는다 (판정 숫자에 쓰지 않는 참고 칸)', async () => {
    const { tripId } = await setup()
    // 아들이 이미 있던 '나'(t3)에 자기 계정을 연결만 했다 → 걷기 조건은 그대로라 filledBySelf는 false
    await replaceTravelers(
      {
        tripId,
        actorUserId: SON,
        travelers: [
          traveler({ id: 't1', label: '엄마', userId: MOM, isParent: true }),
          traveler({ id: 't2', label: '할머니', isParent: true }),
          traveler({ id: 't3', label: '나', userId: SON }),
        ],
      },
      testDb.db,
    )

    const patched = await patchTraveler(
      { tripId, travelerId: 't3', patch: { exerciseFrequency: 'five_plus' }, actorUserId: SON },
      testDb.db,
    )

    expect(patched.exerciseFrequency).toBe('five_plus')
    expect(patched.filledBySelf).toBe(false)
  })
})
