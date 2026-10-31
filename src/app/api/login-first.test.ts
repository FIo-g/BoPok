// 로그인 검사가 본문 검사보다 먼저인지 본다.
// 로그인 안 한 사람이 잘못된 본문을 보내면 400이 아니라 401이어야 한다
// (400이 먼저 나가면 로그인 안 한 사람이 요청 모양을 더듬어 볼 수 있고, 화면도 '로그인이 필요해요'를 띄우지 못한다).
// 여러 라우트에 걸친 규칙이라 라우트별 테스트 파일이 아니라 한 파일에 모았다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema } from '@/lib/contracts'
import type { TestDb } from '@/lib/db/test-db'
import { setupTestDb } from '@/lib/db/test-db'
import { jsonRequestWith, readBody, routeParams } from '@/lib/auth/test-fixtures'
import { POST as postGroup } from './groups/route'
import { POST as acceptInvite } from './invites/[token]/accept/route'
import { POST as postTrip } from './trips/route'
import { PATCH as patchTrip } from './trips/[id]/route'
import { POST as postConfirm } from './trips/[id]/confirm/route'
import { PUT as putTravelers } from './trips/[id]/travelers/route'
import { PATCH as patchTraveler } from './trips/[id]/travelers/[tid]/route'
import { POST as postVersion } from './trips/[id]/versions/route'
import { POST as postOpinion } from './versions/[vid]/opinions/route'

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

afterAll(async () => {
  await testDb.close()
  vi.unstubAllEnvs()
})

// 쿠키 없이(로그인 안 한 상태로) 보내는 요청
const anonymous = (method: string, path: string, body: unknown) => jsonRequestWith({ method, path, body })

type Case = { name: string; call: () => Promise<Response> }

// 본문을 읽는 모든 API. 일부러 계약(zod 스키마)에 어긋나는 본문을 보낸다.
const cases: Case[] = [
  {
    name: 'POST /api/groups (이름이 공백뿐)',
    call: () => postGroup(anonymous('POST', '/api/groups', { name: '   ' })),
  },
  {
    name: 'POST /api/invites/:token/accept (relation이 숫자)',
    call: () => acceptInvite(anonymous('POST', '/api/invites/x/accept', { relation: 123 }), routeParams({ token: 'x' })),
  },
  {
    name: 'POST /api/trips (제목이 공백뿐)',
    call: () => postTrip(anonymous('POST', '/api/trips', { groupId: 'g', title: '   ', mode: 'scratch' })),
  },
  {
    name: 'PATCH /api/trips/:id (제목이 빈 문자)',
    call: () => patchTrip(anonymous('PATCH', '/api/trips/x', { title: '' }), routeParams({ id: 'x' })),
  },
  {
    name: 'POST /api/trips/:id/confirm (versionId 없음)',
    call: () => postConfirm(anonymous('POST', '/api/trips/x/confirm', {}), routeParams({ id: 'x' })),
  },
  {
    name: 'PUT /api/trips/:id/travelers (빈 목록)',
    call: () => putTravelers(anonymous('PUT', '/api/trips/x/travelers', { travelers: [] }), routeParams({ id: 'x' })),
  },
  {
    name: 'PATCH /api/trips/:id/travelers/:tid (pace가 엉뚱한 값)',
    call: () =>
      patchTraveler(
        anonymous('PATCH', '/api/trips/x/travelers/y', { pace: 'not-a-pace' }),
        routeParams({ id: 'x', tid: 'y' }),
      ),
  },
  {
    name: 'POST /api/trips/:id/versions (stops가 배열이 아님)',
    call: () => postVersion(anonymous('POST', '/api/trips/x/versions', { stops: 'nope' }), routeParams({ id: 'x' })),
  },
  {
    name: 'POST /api/versions/:vid/opinions (반응도 글도 없음)',
    call: () =>
      postOpinion(
        anonymous('POST', '/api/versions/x/opinions', { stopKey: 's1', reactions: [] }),
        routeParams({ vid: 'x' }),
      ),
  },
]

describe('로그인 안 한 잘못된 본문은 400이 아니라 401', () => {
  it.each(cases)('$name', async ({ call }) => {
    const response = await call()
    expect(response.status).toBe(401)
    expect(ApiErrorSchema.parse(await readBody(response)).error.code).toBe('unauthorized')
  })

  it('POST /api/trips: JSON이 아닌 본문도 401', async () => {
    const response = await postTrip(new Request('http://localhost:3000/api/trips', { method: 'POST', body: 'not json' }))
    expect(response.status).toBe(401)
  })
})
