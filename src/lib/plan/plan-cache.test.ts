import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Leg, LegRequest } from '@/lib/contracts'
import { LEGS_REQUEST_MAX, legKey } from '@/lib/contracts'

// 실제 서버 모드(보행만 지원)에서 경로를 받는 방법: 보행만, 서버 상한 단위로 묶어 한 번에, 응답은 leg.key 로 짝짓는다
// (서버는 일부만 실패하면 실패한 항목만 빼고 200을 주고, 하나도 못 받으면 오류 상태 코드를 준다)
const get = vi.fn<(requests: LegRequest[]) => Promise<Leg[]>>()
vi.mock('@/lib/api-client', () => ({ SUPPORTED_LEG_MODES: ['walk'], api: { legs: { get: (r: LegRequest[]) => get(r) }, places: { details: vi.fn() } } }))

const { clearPlanCache, ensureLegs, getLegsRecord, legFailed, isLegModeSupported, resetFailures } = await import('./plan-cache')

const req = (mode: LegRequest['mode'], x = 127.38): LegRequest => ({ from: { coord: [x, 36.36] }, to: { coord: [x + 0.01, 36.37] }, mode })
// 경로마다 다른 거리를 줘서 어느 경로가 어느 key 에 저장됐는지 구분한다
const leg = (r: LegRequest): Leg => ({ key: legKey(r), mode: r.mode, distanceM: Math.round(r.from.coord[0] * 100), path: [r.from.coord, r.to.coord], stairsStatus: 'unknown', confidence: 'B' })
const answerAll = async (requests: LegRequest[]): Promise<Leg[]> => requests.map(leg)

describe('경로 받기', () => {
  beforeEach(() => {
    clearPlanCache()
    get.mockReset()
  })

  it('지원하는 이동수단만 한 번에 묶어 보내고, 나머지는 서버에 묻지 않고 없음으로 둔다', async () => {
    get.mockImplementation(answerAll)
    await ensureLegs([req('walk'), req('car'), req('walk', 127.4), req('bus', 127.5)])
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0].map(r => legKey(r))).toEqual([legKey(req('walk')), legKey(req('walk', 127.4))])
    expect(Object.keys(getLegsRecord()).sort()).toEqual([legKey(req('walk')), legKey(req('walk', 127.4))].sort())
    expect(legFailed(legKey(req('car')))).toBe(true)
    expect(legFailed(legKey(req('bus', 127.5)))).toBe(true)
    expect(isLegModeSupported(legKey(req('car')))).toBe(false)
    expect(isLegModeSupported(legKey(req('walk')))).toBe(true)
  })

  it('지원하지 않는 이동수단뿐이면 서버를 부르지 않는다', async () => {
    await ensureLegs([req('car'), req('taxi', 127.4)])
    expect(get).not.toHaveBeenCalled()
    expect(legFailed(legKey(req('car')))).toBe(true)
  })

  it('응답은 순서가 아니라 leg.key 로 짝짓는다', async () => {
    const [a, b, c] = [req('walk', 127.30), req('walk', 127.35), req('walk', 127.40)]
    get.mockImplementation(async requests => requests.map(leg).reverse())
    await ensureLegs([a, b, c])
    expect(getLegsRecord()[legKey(a)].distanceM).toBe(12730)
    expect(getLegsRecord()[legKey(b)].distanceM).toBe(12735)
    expect(getLegsRecord()[legKey(c)].distanceM).toBe(12740)
  })

  it('응답에 없는 key 는 실패로 적고, 받은 경로는 저장한다', async () => {
    const [a, b, c] = [req('walk', 127.30), req('walk', 127.35), req('walk', 127.40)]
    get.mockImplementation(async requests => requests.filter(r => legKey(r) !== legKey(b)).map(leg))
    await ensureLegs([a, b, c])
    expect(get).toHaveBeenCalledTimes(1)
    expect(Object.keys(getLegsRecord()).sort()).toEqual([legKey(a), legKey(c)].sort())
    expect(legFailed(legKey(b))).toBe(true)
    expect(legFailed(legKey(a))).toBe(false)
  })

  it('요청이 통째로 실패하면 그 묶음은 모두 실패로 적고 경로를 만들어 채우지 않는다', async () => {
    const [a, b] = [req('walk', 127.30), req('walk', 127.35)]
    get.mockRejectedValue(new Error('502'))
    await ensureLegs([a, b])
    expect(getLegsRecord()).toEqual({})
    expect(legFailed(legKey(a))).toBe(true)
    expect(legFailed(legKey(b))).toBe(true)
  })

  it('서버 상한을 넘으면 상한 단위로 나눠 차례로 보낸다', async () => {
    get.mockImplementation(answerAll)
    const many = Array.from({ length: LEGS_REQUEST_MAX * 2 + 5 }, (_, i) => req('walk', 127 + i * 0.01))
    await ensureLegs(many)
    expect(get.mock.calls.map(([batch]) => batch.length)).toEqual([LEGS_REQUEST_MAX, LEGS_REQUEST_MAX, 5])
    expect(Object.keys(getLegsRecord())).toHaveLength(many.length)
  })

  it('같은 경로를 겹쳐 요청해도 한 번만 보낸다', async () => {
    get.mockImplementation(answerAll)
    await ensureLegs([req('walk'), req('walk')])
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0]).toHaveLength(1)
  })

  it('이미 받은 것은 다시 묻지 않는다', async () => {
    get.mockImplementation(answerAll)
    await ensureLegs([req('walk')])
    await ensureLegs([req('walk')])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('실패로 적은 것은 다시 묻지 않다가, 다시 시도하면 묻는다', async () => {
    get.mockResolvedValueOnce([]).mockImplementation(answerAll)
    await ensureLegs([req('walk')])
    expect(legFailed(legKey(req('walk')))).toBe(true)
    await ensureLegs([req('walk')])
    expect(get).toHaveBeenCalledTimes(1)
    resetFailures()
    await ensureLegs([req('walk')])
    expect(get).toHaveBeenCalledTimes(2)
    expect(getLegsRecord()[legKey(req('walk'))]).toBeDefined()
  })
})
