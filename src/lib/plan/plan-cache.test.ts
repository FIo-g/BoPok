import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'

// 실제 서버 모드(보행만 지원)에서 경로를 받는 방법: 보행만, 하나씩 따로 (서버는 배치 중 하나만 실패해도 전체를 거절한다)
const get = vi.fn<(requests: LegRequest[]) => Promise<Leg[]>>()
vi.mock('@/lib/api-client', () => ({ SUPPORTED_LEG_MODES: ['walk'], api: { legs: { get: (r: LegRequest[]) => get(r) }, places: { details: vi.fn() } } }))

const { clearPlanCache, ensureLegs, getLegsRecord, legFailed, isLegModeSupported } = await import('./plan-cache')

const req = (mode: LegRequest['mode'], x = 127.38): LegRequest => ({ from: { coord: [x, 36.36] }, to: { coord: [x + 0.01, 36.37] }, mode })
const leg = (r: LegRequest): Leg => ({ key: legKey(r), mode: r.mode, distanceM: 300, path: [r.from.coord, r.to.coord], stairsStatus: 'unknown', confidence: 'B' })

describe('경로 받기', () => {
  beforeEach(() => {
    clearPlanCache()
    get.mockReset()
  })

  it('지원하는 이동수단만 보내고, 나머지는 서버에 묻지 않고 없음으로 둔다', async () => {
    get.mockImplementation(async ([r]) => [leg(r)])
    await ensureLegs([req('walk'), req('car'), req('bus', 127.4)])
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0]).toHaveLength(1)
    expect(Object.keys(getLegsRecord())).toEqual([legKey(req('walk'))])
    expect(legFailed(legKey(req('car')))).toBe(true)
    expect(isLegModeSupported(legKey(req('car')))).toBe(false)
    expect(isLegModeSupported(legKey(req('walk')))).toBe(true)
  })

  it('경로는 하나씩 따로 받아서 한 경로가 실패해도 나머지는 받는다', async () => {
    const [a, b, c] = [req('walk', 127.30), req('walk', 127.35), req('walk', 127.40)]
    get.mockImplementation(async ([r]) => {
      if (legKey(r) === legKey(b)) throw new Error('503')
      return [leg(r)]
    })
    await ensureLegs([a, b, c])
    expect(get).toHaveBeenCalledTimes(3)
    expect(Object.keys(getLegsRecord()).sort()).toEqual([legKey(a), legKey(c)].sort())
    expect(legFailed(legKey(b))).toBe(true)
  })

  it('이미 받은 것은 다시 묻지 않는다', async () => {
    get.mockImplementation(async ([r]) => [leg(r)])
    await ensureLegs([req('walk')])
    await ensureLegs([req('walk')])
    expect(get).toHaveBeenCalledTimes(1)
  })
})
