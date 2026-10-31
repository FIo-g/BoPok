// dev-deps 가짜 연결 지점 검사. 외부 API를 부르지 않는다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LegSchema, PlaceDetailSchema } from '@/lib/contracts'
import type { Opinion, Traveler } from '@/lib/contracts'
import { createDevDeps } from './dev-deps'

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

describe('production 막기', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('production이면 개발용 가짜를 만들 수 없다 (x-dev-user 가짜 로그인이 배포에 올라가지 않게)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => createDevDeps()).toThrow('production에서 쓸 수 없어요')
  })

  it('test 환경에서는 만들어진다', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(createDevDeps()).toBeTruthy()
  })
})
