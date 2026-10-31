import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegRequest } from '@/lib/contracts'
import fixture from './fixtures/tmap-car.json'
import { getVehicleRoute, parseVehicleRoute } from './tmap'
import { TMAP_CAR_URL } from './validation'

// JSON 목업을 느슨한 타입으로 복사해서 일부러 잘못된 값도 넣어 본다.
type Feature = { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }
type Body = { type: string; features: Feature[]; error?: unknown }
const copy = () => structuredClone(fixture) as unknown as Body

const request: LegRequest = { from: { coord: [127.38, 36.36] }, to: { coord: [127.382, 36.362] }, mode: 'car' }
beforeEach(() => {
  vi.stubEnv('TMAP_APP_KEY', '')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실제 외부 요청 금지') }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('TMAP 자동차 응답 파싱 — 직접 만든 목업', () => {
  it('총 거리·소요 시간(초를 분으로)·이어진 경로선만 추출하고 요금은 읽지 않는다', () => {
    expect(parseVehicleRoute(fixture)).toEqual({
      distanceM: 4200, durationMin: 13,
      path: [[127.38, 36.36], [127.379, 36.361], [127.381, 36.3615], [127.382, 36.362]],
    })
  })

  it.each([
    null, {}, { type: 'FeatureCollection', features: [] },
    { ...fixture, error: { message: '외부 오류' } },
    { ...fixture, features: fixture.features.filter(feature => feature.geometry.type === 'LineString') },
    { ...fixture, features: fixture.features.slice(1) },
    { ...fixture, features: fixture.features.slice(0, -1) },
  ])('빈 응답·오류·요약이나 출발·도착 점 누락은 성공 경로가 아니다: %j', body => {
    expect(() => parseVehicleRoute(body)).toThrow()
  })

  it.each([undefined, -1, 0, Infinity, '4200'])('총 거리가 잘못되면 거리를 추정하지 않는다: %s', distance => {
    const body = copy()
    Object.assign(body.features[0].properties, { totalDistance: distance })
    expect(() => parseVehicleRoute(body)).toThrow()
  })

  it.each([undefined, -1, 0, Infinity, '780'])('총 시간이 잘못되면 시간을 추정하지 않는다: %s', seconds => {
    const body = copy()
    Object.assign(body.features[0].properties, { totalTime: seconds })
    expect(() => parseVehicleRoute(body)).toThrow()
  })

  it('끊어진 선을 직선으로 잇거나 단일 좌표에서 경로를 만들지 않는다', () => {
    const broken = copy()
    broken.features[3].geometry.coordinates = [[127.39, 36.36], [127.382, 36.362]]
    expect(() => parseVehicleRoute(broken)).toThrow()
    const single = copy()
    single.features[1].geometry.coordinates = [[127.38, 36.36]]
    expect(() => parseVehicleRoute(single)).toThrow()
  })

  it('좌표 순서 오류와 경로선과 맞지 않는 출발·도착점을 거부한다', () => {
    for (const [index, coordinates] of [[0, [36.36, 127.38]], [0, [127.4, 36.4]], [4, [127.4, 36.4]]] as const) {
      const body = copy()
      body.features[index].geometry.coordinates = coordinates
      expect(() => parseVehicleRoute(body)).toThrow()
    }
  })
})

describe('서버 전용 TMAP 자동차 호출', () => {
  it('키 누락은 호출 전에 구분하고 키 값을 오류에 넣지 않는다', async () => {
    await expect(getVehicleRoute(request)).rejects.toMatchObject({ kind: 'missing_key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('정해진 endpoint·헤더·WGS84 경위도와 자동차 옵션으로 호출하고 택시도 같은 경로를 받는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(fixture))
    await expect(getVehicleRoute(request, { apiKey: 'fixture', fetchFn })).resolves.toMatchObject({ distanceM: 4200, durationMin: 13 })
    await expect(getVehicleRoute({ ...request, mode: 'taxi' }, { apiKey: 'fixture', fetchFn })).resolves.toMatchObject({ distanceM: 4200, durationMin: 13 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(TMAP_CAR_URL)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { appKey: 'fixture' } })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      startX: 127.38, startY: 36.36, endX: 127.382, endY: 36.362,
      reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: 0, trafficInfo: 'N', sort: 'index',
    })
    expect(String(url)).not.toContain('fixture')
  })

  it.each([401, 403, 429, 500, 503])('HTTP %s는 재시도 없이 외부 API 오류로 처리한다', async status => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('외부 오류 본문', { status }))
    await expect(getVehicleRoute(request, { apiKey: 'fixture', fetchFn })).rejects.toMatchObject({ kind: 'upstream' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('네트워크 오류·잘못된 JSON·빈 성공 본문은 일반 오류로 감추며 성공시키지 않는다', async () => {
    for (const result of [Promise.reject(new Error('헤더 포함 내부 오류')), Promise.resolve(new Response('{')), Promise.resolve(new Response(''))]) {
      const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => result)
      await expect(getVehicleRoute(request, { apiKey: 'fixture', fetchFn })).rejects.toMatchObject({ kind: 'upstream' })
    }
  })

  it('요청뿐 아니라 본문 수신 중 시간 초과도 구분한다', async () => {
    vi.useFakeTimers()
    for (const bodyStalls of [false, true]) {
      const fetchFn = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        const stalled = new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('테스트 중단', 'AbortError')), { once: true })
        })
        if (!bodyStalls) return stalled
        const response = new Response('{}')
        vi.spyOn(response, 'json').mockImplementation(() => stalled)
        return Promise.resolve(response)
      })
      const result = getVehicleRoute(request, { apiKey: 'fixture', fetchFn, timeoutMs: 25 }).catch(error => error)
      await vi.advanceTimersByTimeAsync(25)
      expect(await result).toMatchObject({ kind: 'timeout' })
      expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true)
    }
  })

  it('car·taxi가 아닌 수단과 잘못된 좌표는 외부 요청 전에 거부한다', async () => {
    await expect(getVehicleRoute({ ...request, mode: 'walk' })).rejects.toMatchObject({ kind: 'unsupported_mode' })
    await expect(getVehicleRoute({ ...request, mode: 'bus' })).rejects.toMatchObject({ kind: 'unsupported_mode' })
    await expect(getVehicleRoute({ ...request, from: { coord: [36, 127] } })).rejects.toMatchObject({ kind: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
