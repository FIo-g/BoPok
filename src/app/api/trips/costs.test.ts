import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { CostPlanResponseSchema, costPlanContext, costScope, placeCostKey, type SaveCostPlan } from '@/lib/contracts'
import { setupTestDb, type TestDb } from '@/lib/db/test-db'
import { tripTravelers, tripVersions, trips, versionCostPlans } from '@/lib/db/schema'
import { addMember, createGroup, insertTrip, jsonRequestWith, requestWith, routeParams, signUp, stop } from '@/lib/auth/test-fixtures'
import { GET, PUT } from './[id]/versions/[vid]/costs/route'

let testDb: TestDb
beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'cost-plan-memory-test-secret')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
}, 60000)
beforeEach(async () => { await testDb.reset() })
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await testDb.close(); vi.unstubAllEnvs() })

async function setup() {
  const owner = await signUp({ name: '만든 가족', email: 'cost-owner@example.com' })
  const member = await signUp({ name: '다른 가족', email: 'cost-family@example.com' })
  const outsider = await signUp({ name: '다른 그룹', email: 'cost-stranger@example.com' })
  const groupId = await createGroup(testDb.db, { name: '비용 테스트 가족', ownerId: owner.userId })
  await addMember(testDb.db, { groupId, userId: member.userId, role: 'member' })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, date: '2026-11-05' })
  await testDb.db.update(trips).set({ endDate: '2026-11-06' }).where(eq(trips.id, tripId))
  await testDb.db.insert(tripTravelers).values([
    { tripId, id: 't1', label: '가족1', pace: 'normal', sortOrder: 0 },
    { tripId, id: 't2', label: '가족2', pace: 'normal', sortOrder: 1 },
  ])
  const stops = [stop({ key: 's1', name: '식사' }), stop({ key: 's2', name: '숙소', day: 2 })]
  const [version] = await testDb.db.insert(tripVersions).values({ tripId, number: 1, madeBy: 'user', stops }).returning()
  const [next] = await testDb.db.insert(tripVersions).values({ tripId, number: 2, madeBy: 'user', stops }).returning()
  const scope = costScope(tripId, version.id, 1)
  const input: SaveCostPlan = { day: 1, context: costPlanContext([stops[0]], 2), baseRevision: null, extraCount: 0,
    drafts: [{ key: placeCostKey(scope, stops[0]), value: { amount: '10000', kind: 'meal', unit: 'per_person', quantity: 1, option: '' } }] }
  const params = routeParams({ id: tripId, vid: version.id })
  return { owner, member, outsider, tripId, version, next, stops, input, params }
}
const put = (cookie: string | undefined, body: unknown) => jsonRequestWith({ method: 'PUT', cookie, body })
const get = (cookie: string | undefined, day = 1) => new Request(`http://localhost:3000/api/trips/x/versions/y/costs?day=${day}`, { headers: cookie ? { cookie } : {} })
async function parsed(response: Response) { expect(response.status).toBe(200); return CostPlanResponseSchema.parse(await response.json()) }

describe('버전·일차별 비용 저장·가족 공유', () => {
  it('작성자가 저장한 비용을 다른 가족이 조회하고 수정한다', async () => {
    const f = await setup()
    const first = await parsed(await PUT(put(f.owner.cookie, f.input), f.params))
    expect(first.plan).toMatchObject({ revision: 1, partySize: 2, updatedByUserId: f.owner.userId })
    expect((await parsed(await GET(get(f.member.cookie), f.params))).plan?.drafts[0].value.amount).toBe('10000')
    const changed = { ...f.input, baseRevision: 1, drafts: [{ ...f.input.drafts[0], value: { ...f.input.drafts[0].value, amount: '12000' } }] }
    const second = await parsed(await PUT(put(f.member.cookie, changed), f.params))
    expect(second.plan).toMatchObject({ revision: 2, updatedByName: '다른 가족' })
    expect((await parsed(await GET(get(f.owner.cookie), f.params))).plan?.drafts[0].value.amount).toBe('12000')
  })
  it('다른 일차·버전은 비용을 이어받지 않는다', async () => {
    const f = await setup()
    await PUT(put(f.owner.cookie, f.input), f.params)
    expect((await parsed(await GET(get(f.owner.cookie, 2), f.params))).plan).toBeNull()
    expect((await parsed(await GET(get(f.owner.cookie), routeParams({ id: f.tripId, vid: f.next.id })))).plan).toBeNull()
  })
  it('로그인 전·다른 그룹은 조회·저장할 수 없다', async () => {
    const f = await setup()
    expect((await GET(requestWith(), f.params)).status).toBe(401)
    expect((await PUT(put(undefined, f.input), f.params)).status).toBe(401)
    expect((await GET(get(f.outsider.cookie), f.params)).status).toBe(403)
    expect((await PUT(put(f.outsider.cookie, f.input), f.params)).status).toBe(403)
  })
  it('동시에 저장하면 먼저 저장한 가족의 금액을 덮어쓰지 않는다', async () => {
    const f = await setup()
    await PUT(put(f.owner.cookie, f.input), f.params)
    expect((await PUT(put(f.member.cookie, f.input), f.params)).status).toBe(409)
    const change = { ...f.input, baseRevision: 1 }
    expect((await PUT(put(f.member.cookie, change), f.params)).status).toBe(200)
    expect((await PUT(put(f.owner.cookie, change), f.params)).status).toBe(409)
    expect((await parsed(await GET(get(f.owner.cookie), f.params))).plan?.revision).toBe(2)
  })
  it('저장하지 않은 일정·바뀐 인원은 거부하고 기존 비용을 보존한다', async () => {
    const f = await setup()
    await PUT(put(f.owner.cookie, f.input), f.params)
    const edited = { ...f.input, baseRevision: 1, context: costPlanContext([stop({ key: 'other', name: '다른 식당' })], 2) }
    expect((await PUT(put(f.owner.cookie, edited), f.params)).status).toBe(409)
    await testDb.db.insert(tripTravelers).values({ tripId: f.tripId, id: 't3', label: '추가 가족', pace: 'normal', sortOrder: 2 })
    expect((await PUT(put(f.owner.cookie, { ...f.input, baseRevision: 1 }), f.params)).status).toBe(409)
    expect((await parsed(await GET(get(f.owner.cookie), f.params))).plan?.partySize).toBe(2)
  })
  it('없는 일차·다른 여행 버전·임의 항목과 중복·음수 입력은 거부한다', async () => {
    const f = await setup()
    expect((await GET(get(f.owner.cookie, 99), f.params)).status).toBe(400)
    const another = await insertTrip(testDb.db, { groupId: (await testDb.db.select().from(trips).where(eq(trips.id, f.tripId)))[0].groupId, createdBy: f.owner.userId })
    expect((await GET(get(f.owner.cookie), routeParams({ id: another, vid: f.version.id }))).status).toBe(404)
    for (const body of [
      { ...f.input, drafts: [{ ...f.input.drafts[0], key: 'someone-elses-cost' }] },
      { ...f.input, drafts: [f.input.drafts[0], f.input.drafts[0]] },
      { ...f.input, drafts: [{ ...f.input.drafts[0], value: { ...f.input.drafts[0].value, amount: '-100' } }] },
    ]) expect((await PUT(put(f.owner.cookie, body), f.params)).status).toBe(400)
  })
  it('마이그레이션 전에는 계산 화면을 유지하며 저장만 준비 중으로 응답한다', async () => {
    const f = await setup()
    await testDb.db.execute('drop table version_cost_plans')
    try {
      expect((await parsed(await GET(get(f.owner.cookie), f.params))).available).toBe(false)
      expect((await PUT(put(f.owner.cookie, f.input), f.params)).status).toBe(503)
    } finally {
      // 이 테스트의 메모리 DB만 복구한다. 다음 테스트·외부 DB에는 영향을 주지 않는다.
      const rows = await import('node:fs/promises').then(fs => fs.readFile('drizzle/0006_trip-cost-plans.sql', 'utf8'))
      for (const statement of rows.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) await testDb.db.execute(statement)
    }
  })
  it('입력 초안의 빈 금액·미확인 단위를 그대로 보존한다', async () => {
    const f = await setup()
    const input = { ...f.input, drafts: [{ ...f.input.drafts[0], value: { ...f.input.drafts[0].value, amount: '', unit: '' } }] }
    const response = await parsed(await PUT(put(f.owner.cookie, input), f.params))
    expect(response.plan?.drafts[0].value).toMatchObject({ amount: '', unit: '' })
    expect(await testDb.db.select().from(versionCostPlans)).toHaveLength(1)
  })
})
