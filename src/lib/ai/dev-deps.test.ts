// dev-deps 가짜 연결 지점 검사. 외부 API를 부르지 않는다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LegSchema, PlaceDetailSchema } from '@/lib/contracts'
import type { InterviewState, Opinion, Traveler } from '@/lib/contracts'
import { createDevDeps, getAiDeps } from './dev-deps'

describe('dev requireTripMember', () => {
  it('dev requireTripMember: 헤더 없으면 401, 다른 여행 403', async () => {
    const deps = createDevDeps()
    const guest = new Request('https://example.com/api/ai/interview', { method: 'POST' })
    await expect(deps.requireTripMember(guest, 'trip-dev')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    })
    const member = new Request('https://example.com/api/ai/interview', {
      method: 'POST',
      headers: { 'x-dev-user': 'u-son' },
    })
    await expect(deps.requireTripMember(member, 'trip-other')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    })
    const user = await deps.requireTripMember(member, 'trip-dev')
    expect(user.userId).toBe('u-son')
  })
})

describe('dev-deps 가짜 데이터', () => {
  it('dev 장소는 PlaceDetailSchema 통과', async () => {
    const deps = createDevDeps()
    const details = await deps.getPlaceDetails(['hanbat', 'science', 'museum'])
    expect(details).toHaveLength(3)
    for (const detail of details) {
      expect(PlaceDetailSchema.parse(detail)).toBeTruthy()
    }
  })

  it('dev getLegs 결과는 LegSchema 통과', async () => {
    const deps = createDevDeps()
    const legs = await deps.getLegs([
      {
        from: { placeId: 'hanbat', nodeId: 'p', coord: [127.3745, 36.3498] },
        to: { placeId: 'science', nodeId: 'p2', coord: [127.2546, 36.3926] },
        mode: 'bus',
      },
      {
        from: { coord: [127.3745, 36.3498] },
        to: { coord: [127.376, 36.351] },
        mode: 'walk',
      },
    ])
    expect(legs).toHaveLength(2)
    for (const leg of legs) {
      const parsed = LegSchema.parse(leg)
      // 하버사인 × 1.3 추정이므로 0보다 커야 한다
      expect(parsed.distanceM).toBeGreaterThan(0)
      expect(parsed.confidence).toBe('C')
      expect(parsed.source).toBe('개발용 추정')
      expect(parsed.stairsStatus).toBe('unknown')
    }
  })

  it('dev 여행자 저장은 저장 뒤 조회에 나온다', async () => {
    const deps = createDevDeps()
    const travelers: Traveler[] = [
      {
        id: 't-new',
        label: '아빠',
        age: 70,
        pace: 'normal',
        mobilityAid: false,
        isParent: true,
        condition: {},
        filledBySelf: true,
      },
    ]
    await deps.saveTravelers('trip-dev', travelers)
    const context = await deps.getTripContext('trip-dev')
    expect(context.travelers).toEqual(travelers)
  })

  it('dev 인터뷰 상태는 메모리에 저장됐다가 돌아온다', async () => {
    const deps = createDevDeps()
    await expect(deps.interviews.get('trip-dev')).resolves.toBeNull()
    await deps.interviews.save('trip-dev', {
      filled: { mode: 'scratch', travelers: [], styles: [], mustVisit: [], fixTargets: [] },
      cursor: { slot: 'travelers', travelerIndex: 0, questionIndex: 0 },
      history: [],
    })
    const state = await deps.interviews.get('trip-dev')
    expect(state?.cursor.slot).toBe('travelers')
  })

  it('seed 의견이 getOpinions으로 나온다', async () => {
    const opinion: Opinion = {
      id: 'op-seed',
      versionId: 'v9',
      stopKey: null,
      userId: 'u-mom',
      userName: '엄마',
      reactions: ['too_far'],
      comment: null,
      appliedInVersionId: null,
      createdAt: '2026-10-30T00:00:00.000Z',
    }
    const deps = createDevDeps({ opinions: [opinion] })
    await expect(deps.getOpinions('v9')).resolves.toEqual([opinion])
    await expect(deps.getOpinions('v-없음')).resolves.toEqual([])
  })

  it('dev 버전 저장은 번호를 매긴다', async () => {
    const deps = createDevDeps()
    const first = await deps.createVersion('trip-dev', { parentId: null, stops: [], madeBy: 'ai' })
    const second = await deps.createVersion('trip-dev', {
      parentId: first.id,
      stops: [],
      madeBy: 'ai',
      note: '다시 짠 일정',
      appliedOpinionIds: ['o1'],
    })
    expect(second.number).toBe(first.number + 1)
    expect(second.parentId).toBe(first.id)
    expect(second.madeBy).toBe('ai')
  })
})

describe('getAiDeps', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('개발 환경이면 메모리 가짜를 돌려준다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(getAiDeps()).toBeTruthy()
  })

  it('test 환경이면 메모리 가짜를 돌려준다', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(getAiDeps()).toBeTruthy()
  })

  it('getAiDeps() 두 번은 같은 객체이고 인터뷰 상태가 이어진다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const first = getAiDeps()
    const second = getAiDeps()
    expect(second).toBe(first) // 요청마다 새로 만들면 인터뷰 상태·버전이 이어지지 않는다
    const state: InterviewState = {
      filled: { mode: 'scratch', travelers: [], styles: [], mustVisit: [], fixTargets: [] },
      cursor: { slot: 'travelers', travelerIndex: 0, questionIndex: 0 },
      history: [],
    }
    await first.interviews.save('trip-singleton', state)
    await expect(second.interviews.get('trip-singleton')).resolves.toEqual(state)
  })

  it('production이면 501 연결 전 오류를 던지는 deps', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const deps = getAiDeps()
    const request = new Request('https://example.com/api/ai/interview', { method: 'POST' })
    await expect(deps.requireTripMember(request, 'trip-dev')).rejects.toMatchObject({ status: 501 })
    await expect(deps.callJson({ messages: [], schema: { safeParse: () => null } as never })).rejects.toMatchObject({
      status: 501,
    })
  })

  it('NODE_ENV가 비어 있어도 501 연결 전 오류를 던지는 deps', async () => {
    vi.stubEnv('NODE_ENV', '')
    const deps = getAiDeps()
    const request = new Request('https://example.com/api/ai/interview', { method: 'POST' })
    await expect(deps.requireTripMember(request, 'trip-dev')).rejects.toMatchObject({ status: 501 })
  })
})
