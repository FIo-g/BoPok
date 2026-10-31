import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegRequest } from '@/lib/contracts'
import fixture from './fixtures/tmap-walk.json'
import { getWalkingRoute, parseWalkingRoute } from './tmap'
import { TMAP_PEDESTRIAN_URL } from './validation'

const request: LegRequest = { from: { coord: [127.38, 36.36] }, to: { coord: [127.382, 36.362] }, mode: 'walk' }
beforeEach(() => {
  vi.stubEnv('TMAP_APP_KEY', '')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실제 외부 요청 금지') }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('TMAP 보행 응답 파싱 — 직접 만든 목업', () => {
  it('총 거리와 실제 응답 경로선만 추출하고 보행 시간은 만들지 않는다', () => {
    expect(parseWalkingRoute(fixture)).toEqual({
      distanceM: 300, path: [[127.38, 36.36], [127.381, 36.361], [127.382, 36.362]],
    })
  })

  it.each([
    null, {}, { type: 'FeatureCollection', features: [] },
    { ...fixture, error: { message: '외부 오류' } },
    { ...fixture, features: fixture.features.filter(feature => feature.geometry.type === 'Point') },
    { ...fixture, features: fixture.features.slice(0, -1) },
    { ...fixture, features: fixture.features.slice(1) },
  ])('빈 응답·오류·필수 도형 누락은 성공 경로가 아니다: %j', body => {
    expect(() => parseWalkingRoute(body)).toThrow()
  })

  it.each([undefined, -1, 0, Infinity, '300'])('총 거리가 잘못되면 거리를 추정하지 않는다: %s', distance => {
    const body = structuredClone(fixture)
    Object.assign(body.features[0].properties, { totalDistance: distance })
    expect(() => parseWalkingRoute(body)).toThrow()
  })

  it('끊어진 선을 직선으로 잇거나 단일 좌표에서 경로를 만들지 않는다', () => {
    const broken = structuredClone(fixture)
    broken.features[2].geometry.coordinates = [[127.39, 36.36], [127.382, 36.362]]
    expect(() => parseWalkingRoute(broken)).toThrow()
    const single = structuredClone(fixture)
    single.features[1].geometry.coordinates = [[127.38, 36.36]]
    expect(() => parseWalkingRoute(single)).toThrow()
  })

  it('좌표 순서 오류와 불일치하는 출발·도착점, 퇴화한 선을 거부한다', () => {
    for (const coordinates of [[36.36, 127.38], [181, 36.36], [127.4, 36.4]]) {
      const body = structuredClone(fixture)
      body.features[0].geometry.coordinates = coordinates
      expect(() => parseWalkingRoute(body)).toThrow()
    }
    const body = structuredClone(fixture)
    body.features = [body.features[0], body.features[1], body.features[3]]
    body.features[1].geometry.coordinates = [[127.38, 36.36], [127.38, 36.36]]
    expect(() => parseWalkingRoute(body)).toThrow()
  })
})

describe('서버 전용 TMAP 호출', () => {
  it('키 누락은 호출 전에 구분하고 키 값을 오류에 넣지 않는다', async () => {
    await expect(getWalkingRoute(request)).rejects.toMatchObject({ kind: 'missing_key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('정해진 endpoint·헤더·WGS84 경위도와 일반 보행 옵션으로 한 번 호출한다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture))
    await expect(getWalkingRoute(request, { apiKey: 'fixture', fetchFn })).resolves.toMatchObject({ distanceM: 300 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(TMAP_PEDESTRIAN_URL)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { appKey: 'fixture' } })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      startX: 127.38, startY: 36.36, endX: 127.382, endY: 36.362,
      reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0', sort: 'index',
    })
    expect(String(url)).not.toContain('fixture')
  })

  it.each([401, 403, 429, 500, 503])('HTTP %s는 재시도 없이 외부 API 오류로 처리한다', async status => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('외부 오류 본문', { status }))
    await expect(getWalkingRoute(request, { apiKey: 'fixture', fetchFn })).rejects.toMatchObject({ kind: 'upstream' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('네트워크 오류·잘못된 JSON·빈 성공 본문은 일반 오류로 감추며 성공시키지 않는다', async () => {
    for (const result of [Promise.reject(new Error('헤더 포함 내부 오류')), Promise.resolve(new Response('{')), Promise.resolve(new Response(''))]) {
      const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => result)
      await expect(getWalkingRoute(request, { apiKey: 'fixture', fetchFn })).rejects.toMatchObject({ kind: 'upstream' })
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
      const result = getWalkingRoute(request, { apiKey: 'fixture', fetchFn, timeoutMs: 25 }).catch(error => error)
      await vi.advanceTimersByTimeAsync(25)
      expect(await result).toMatchObject({ kind: 'timeout' })
      expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true)
    }
  })

  it('미지원 수단과 잘못된 좌표는 외부 요청 전에 거부한다', async () => {
    await expect(getWalkingRoute({ ...request, mode: 'car' })).rejects.toMatchObject({ kind: 'unsupported_mode' })
    await expect(getWalkingRoute({ ...request, from: { coord: [36, 127] } })).rejects.toMatchObject({ kind: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
