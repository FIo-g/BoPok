// 실제 연결(real-deps) 검사. 진짜 계정·여행·장소 함수를 메모리 DB 위에서 돌린다.
// 외부 API는 부르지 않는다: AI(callJson)와 경로(TMAP)만 가짜로 바꿔 끼운다.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ApiErrorSchema,
  ParseScheduleResponseSchema,
  PlanResponseSchema,
  type InterviewState,
  type LegRequest,
} from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { createGroup, insertTrip, signUp, traveler } from '@/lib/auth/test-fixtures'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { insertPilotPlaces, PilotPlaceSchema } from '@/lib/places/seed'
import { replaceTravelers } from '@/lib/trips'
import type { AiDeps } from './deps'
import { handleGenerate } from './generate'
import { handle } from './http'
import { handleInterview } from './interview'
import { handleParseSchedule } from './parse-schedule'
import { createLegsAdapter } from './place-adapters'
import { createRealDeps, getAiDeps } from './real-deps'

let testDb: TestDb

beforeAll(async () => {
  // .env.local이 없는 컴퓨터(다른 팀원·GitHub Actions)에서도 돌아야 한다.
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('PGLITE_DIR', 'memory://')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-only-for-vitest')
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  testDb = await setupTestDb()
}, 60_000)

// 시범 장소 3곳(hanbat, art, leeungno) — 장소 API 테스트와 같은 파일을 쓴다.
const pilots = ['hanbat', 'art', 'leeungno'].map(id =>
  PilotPlaceSchema.parse(JSON.parse(readFileSync(new URL(`../../../data/places/${id}.json`, import.meta.url), 'utf8'))),
)

beforeEach(async () => {
  await testDb.reset()
  await insertPilotPlaces(testDb.db, pilots)
})

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

async function tripFor(mode: 'paste' | 'scratch' = 'scratch') {
  const owner = await signUp({ name: '김경선', email: 'gs@example.com' })
  const groupId = await createGroup(testDb.db, { name: '우리 가족', ownerId: owner.userId })
  const tripId = await insertTrip(testDb.db, { groupId, createdBy: owner.userId, mode })
  return { owner, groupId, tripId }
}

function aiRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/ai/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// AI가 돌려줄 값을 스키마로 검사해 돌려주는 가짜 callJson (generate.test.ts와 같은 방식)
function fakeCallJson(payload: unknown): AiDeps['callJson'] {
  return (async (req: { schema: z.ZodType<unknown> }) => req.schema.parse(payload)) as unknown as AiDeps['callJson']
}

// TMAP 대신 요청마다 300 m 길을 돌려주는 가짜 경로 서비스
const fakeLegs = createLegsAdapter(async (requests: LegRequest[]) => ({
  legs: requests.map(request => ({
    key: legKey(request),
    mode: request.mode,
    distanceM: 300,
    path: [request.from.coord, request.to.coord],
    stairsStatus: 'unknown' as const,
    source: '테스트용',
    checkedAt: '2026-10-31',
    confidence: 'B' as const,
  })),
  failed: [],
}))

describe('getAiDeps', () => {
  it('같은 객체를 돌려준다', () => {
    expect(getAiDeps()).toBe(getAiDeps())
  })
})

describe('권한 — 진짜 로그인과 구성원 검사', () => {
  it('로그인 안 한 요청은 401', async () => {
    const { tripId } = await tripFor()
    const response = await handleInterview(aiRequest('interview', { tripId }), createRealDeps())
    expect(response.status).toBe(401)
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('unauthorized')
  })

  it('x-dev-user 헤더는 무시된다 — 헤더만으로는 들어올 수 없다', async () => {
    const { owner, tripId } = await tripFor()
    const response = await handleInterview(
      aiRequest('interview', { tripId }, { 'x-dev-user': owner.userId }),
      createRealDeps(),
    )
    expect(response.status).toBe(401)
  })

  it('그룹 구성원이 아닌 로그인 사용자는 403', async () => {
    const { tripId } = await tripFor()
    const stranger = await signUp({ name: '낯선 사람', email: 'stranger@example.com' })
    const response = await handleInterview(aiRequest('interview', { tripId }, { cookie: stranger.cookie }), createRealDeps())
    expect(response.status).toBe(403)
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('forbidden')
  })

  it('없는 여행도 403 (그 여행이 있는지 새어 나가지 않게)', async () => {
    const { owner } = await tripFor()
    const response = await handleInterview(
      aiRequest('interview', { tripId: 'no-such-trip' }, { cookie: owner.cookie }),
      createRealDeps(),
    )
    expect(response.status).toBe(403)
  })

  it('여행 조회에서 나온 404는 500이 아니라 404로 나간다', async () => {
    const deps = createRealDeps()
    const response = await handle(() => deps.getTripContext('no-such-trip'))
    expect(response.status).toBe(404)
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('not_found')
  })
})

describe('인터뷰 — 진짜 여행·인터뷰 저장', () => {
  it('첫 질문을 받고 상태가 DB에 저장된다', async () => {
    const { owner, tripId } = await tripFor()
    const deps = createRealDeps({
      callJson: (async () => {
        throw new Error('첫 질문에는 AI가 필요 없다')
      }) as unknown as AiDeps['callJson'],
    })

    const response = await handleInterview(aiRequest('interview', { tripId }, { cookie: owner.cookie }), deps)

    expect(response.status).toBe(200)
    const saved = await deps.interviews.get(tripId)
    expect(saved?.filled.mode).toBe('scratch')
  })
})

describe('붙여넣기 정리 — 진짜 장소 DB', () => {
  it('DB 장소는 id로 맞추고, 못 맞춘 이름은 좌표 없이 정보 없음으로 둔다', async () => {
    const { owner, tripId } = await tripFor('paste')
    const deps = createRealDeps({ callJson: fakeCallJson({ items: [{ name: '10시 한밭수목원 산책' }, { name: '성심당 본점' }] }) })

    const response = await handleParseSchedule(
      aiRequest('parse-schedule', { tripId, text: '10시 한밭수목원 산책\n성심당 본점' }, { cookie: owner.cookie }),
      deps,
    )

    expect(response.status).toBe(200)
    const body = ParseScheduleResponseSchema.parse(await response.json())
    expect(body.stops.map(stop => stop.placeId)).toEqual(['hanbat', null])
    expect(body.stops[1].coord).toBeUndefined() // TMAP POI 검색이 없으므로 좌표를 지어내지 않는다
    expect(body.unmatched).toEqual(['성심당 본점'])
    expect((await deps.interviews.get(tripId))?.filled.pastedText).toContain('성심당')
  })
})

describe('처음부터 일정 — 진짜 여행·장소·버전 저장', () => {
  it('후보에서 골라 판정하고 AI 버전으로 DB에 저장한다', async () => {
    const { owner, tripId } = await tripFor()
    await replaceTravelers({
      tripId,
      travelers: [traveler({ id: 't1', label: '엄마', age: 72, sex: 'female', isParent: true })],
    })
    const deps = createRealDeps({
      callJson: fakeCallJson({
        stops: [
          { placeId: 'hanbat', name: '한밭수목원' },
          { placeId: 'art', name: '대전시립미술관' },
          { placeId: 'no-such-place', name: '없는 곳' }, // 후보 밖 id는 버려진다
        ],
        note: '덜 걷는 일정',
      }),
      getLegs: fakeLegs,
    })
    const done: InterviewState = {
      filled: { mode: 'scratch', travelers: [], styles: ['자연·산책'], mustVisit: [], fixTargets: [], transport: 'car' },
      cursor: { slot: 'done', travelerIndex: 0, questionIndex: 0 },
      history: [],
    }
    await deps.interviews.save(tripId, done)

    const response = await handleGenerate(aiRequest('generate', { tripId }, { cookie: owner.cookie }), deps)

    expect(response.status).toBe(200)
    const body = PlanResponseSchema.parse(await response.json())
    expect(body.version.stops.map(stop => stop.placeId)).toEqual(['hanbat', 'art'])
    // 진짜 createVersion이 저장했다: 같은 버전이 DB에서 다시 읽힌다
    const context = await deps.getTripContext(tripId)
    expect(context.versions).toHaveLength(1)
    expect(context.versions[0]).toMatchObject({
      id: body.version.id,
      madeBy: 'ai',
      madeByUserId: owner.userId,
      note: '덜 걷는 일정',
    })
  })
})
