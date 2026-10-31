import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/tmap-poi.json'
import { parsePoiResponse, searchPoi, TMAP_POI_URL } from './poi'

const KEY = 'fixture-key'
const DAEJEON_ITEM = { name: '한밭수목원', upperAddrName: '대전', noorLon: '127.387876', noorLat: '36.365932' }
const withItems = (...poi: unknown[]) => ({ searchPoiInfo: { pois: { poi } } })
const loggedText = () => JSON.stringify(vi.mocked(console.error).mock.calls)
// 던져진 값을 돌려준다(던지지 않으면 undefined).
function thrownBy(run: () => unknown): unknown {
  try { run() } catch (error) { return error }
  return undefined
}

beforeEach(() => {
  vi.stubEnv('TMAP_APP_KEY', '')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('실제 외부 요청 금지') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('TMAP POI 응답 파싱 — 직접 만든 목업', () => {
  it('대전 밖 결과를 건너뛰고 이름이 맞는 첫 대전 결과의 중심 좌표를 돌려준다', () => {
    expect(parsePoiResponse(fixture, '한밭수목원')).toEqual({ name: '한밭수목원', coord: [127.387876, 36.365932] })
  })

  it('이름 비교는 공백·기호·대소문자를 무시한다', () => {
    expect(parsePoiResponse(fixture, ' 한밭 수목원! ')).toEqual({ name: '한밭수목원', coord: [127.387876, 36.365932] })
  })

  it('더 구체적인 검색어는 그 이름의 결과를 고른다', () => {
    expect(parsePoiResponse(fixture, '한밭수목원 주차장')).toEqual({ name: '한밭수목원 주차장', coord: [127.3891, 36.3648] })
  })

  it('결과 이름에 검색어가 들어 있지 않으면 가까운 다른 곳의 좌표를 내놓지 않는다', () => {
    expect(parsePoiResponse(fixture, '성심당')).toBeNull()
    expect(parsePoiResponse(fixture, '한밭수목원 근처 식당')).toBeNull()
  })

  it('중심 좌표가 없으면 입구 좌표를, 숫자로 온 좌표도 쓴다', () => {
    expect(parsePoiResponse(withItems({ name: '한밭수목원', upperAddrName: '대전', frontLon: '127.3882', frontLat: '36.3661' }), '한밭수목원'))
      .toEqual({ name: '한밭수목원', coord: [127.3882, 36.3661] })
    expect(parsePoiResponse(withItems({ name: '한밭수목원', noorLon: 127.387876, noorLat: 36.365932 }), '한밭수목원'))
      .toEqual({ name: '한밭수목원', coord: [127.387876, 36.365932] })
  })

  it('주소가 없는 결과는 좌표가 대전 안일 때만 쓴다', () => {
    expect(parsePoiResponse(withItems({ name: '한밭수목원', noorLon: '127.387876', noorLat: '36.365932' }), '한밭수목원')).not.toBeNull()
    expect(parsePoiResponse(withItems({ name: '한밭수목원', noorLon: '126.978', noorLat: '37.5665' }), '한밭수목원')).toBeNull()
  })

  it.each([
    ['서울 주소와 좌표', { ...DAEJEON_ITEM, upperAddrName: '서울', noorLon: '126.978', noorLat: '37.5665' }],
    ['대전 주소지만 좌표가 대전 밖', { ...DAEJEON_ITEM, noorLon: '127.7', noorLat: '36.3' }],
    ['사각형 안이지만 세종 주소', { ...DAEJEON_ITEM, upperAddrName: '세종특별자치시', noorLon: '127.265', noorLat: '36.5' }],
    ['경도·위도 순서가 뒤바뀜', { ...DAEJEON_ITEM, noorLon: '36.365932', noorLat: '127.387876' }],
    ['빈 문자열 좌표', { ...DAEJEON_ITEM, noorLon: '', noorLat: '' }],
    ['숫자가 아닌 좌표', { ...DAEJEON_ITEM, noorLon: 'abc', noorLat: 'def' }],
    ['좌표 없음', { name: '한밭수목원', upperAddrName: '대전' }],
  ])('대전 밖이거나 좌표를 믿을 수 없는 결과는 버린다: %s', (_label, item) => {
    expect(parsePoiResponse(withItems(item), '한밭수목원')).toBeNull()
  })

  it('항목 하나가 이상해도 다음 항목을 쓴다', () => {
    expect(parsePoiResponse(withItems({ noorLon: '127.38', noorLat: '36.36' }, 'x', null, DAEJEON_ITEM), '한밭수목원'))
      .toEqual({ name: '한밭수목원', coord: [127.387876, 36.365932] })
  })

  it('결과가 비어 있으면 null이다 (오류가 아니다)', () => {
    expect(parsePoiResponse(withItems(), '한밭수목원')).toBeNull()
  })

  it.each([null, {}, 'x', { error: { message: '외부 오류' } }, { searchPoiInfo: {} }, { searchPoiInfo: { pois: {} } }])(
    '응답 모양이 다르면 upstream 오류: %j', body => {
      expect(thrownBy(() => parsePoiResponse(body, '한밭수목원'))).toMatchObject({ kind: 'upstream' })
    },
  )
})

describe('서버 전용 TMAP POI 호출', () => {
  it('키가 없으면 외부 요청 없이 null이고 실패 종류만 남긴다', async () => {
    await expect(searchPoi('한밭수목원')).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[geo]', 'POI 검색 실패', 'missing_key')
  })

  it('정해진 주소·헤더·WGS84 경위도로 한 번 호출하고 키는 주소에 넣지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture))
    await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn })).resolves.toEqual({
      name: '한밭수목원', coord: [127.387876, 36.365932],
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url).startsWith(`${TMAP_POI_URL}?`)).toBe(true)
    expect(String(url)).toContain(`searchKeyword=${encodeURIComponent('한밭수목원')}`)
    expect(String(url)).toContain('reqCoordType=WGS84GEO')
    expect(String(url)).toContain('resCoordType=WGS84GEO')
    expect(String(url)).toContain('count=10')
    expect(String(url)).not.toContain(KEY)
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store', headers: { appKey: KEY } })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('환경 변수의 키를 쓰고 검색어 앞뒤 공백은 지운다', async () => {
    vi.stubEnv('TMAP_APP_KEY', KEY)
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture))
    await expect(searchPoi(' 한밭 수목원 ', { fetchFn })).resolves.not.toBeNull()
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toContain(`searchKeyword=${encodeURIComponent('한밭 수목원')}`)
    expect(init).toMatchObject({ headers: { appKey: KEY } })
  })

  it.each(['', '   ', '길', '...', 'a'.repeat(101)])('검색할 수 없는 이름은 외부 요청 없이 null: %j', async name => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(searchPoi(name, { apiKey: KEY, fetchFn })).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500, 503])('HTTP %s는 재시도 없이 null이고 키·본문을 로그에 남기지 않는다', async status => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('외부 오류 본문', { status }))
    await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn })).resolves.toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith('[geo]', 'POI 검색 실패', 'upstream')
    expect(loggedText()).not.toContain(KEY)
    expect(loggedText()).not.toContain('외부 오류 본문')
  })

  it('네트워크 오류는 null이고 오류 원문(키 포함)을 로그에 남기지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error(`appKey ${KEY} 포함 내부 오류`))
    await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn })).resolves.toBeNull()
    expect(console.error).toHaveBeenCalledWith('[geo]', 'POI 검색 실패', 'upstream')
    expect(loggedText()).not.toContain(KEY)
    expect(loggedText()).not.toContain('내부 오류')
  })

  it('fetch가 동기적으로 던져도 던지지 않고 null이다', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => { throw new Error('동기 오류') })
    await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn })).resolves.toBeNull()
  })

  it('잘못된 JSON·빈 성공 본문·모양이 다른 본문은 null이다', async () => {
    for (const body of ['{', '', JSON.stringify({ error: { message: '외부 오류' } })]) {
      vi.mocked(console.error).mockClear()
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
      await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn })).resolves.toBeNull()
      expect(console.error).toHaveBeenCalledWith('[geo]', 'POI 검색 실패', 'upstream')
    }
  })

  it('정상적으로 결과가 없으면(204, 빈 목록, 대전 밖뿐) 로그 없이 null이다', async () => {
    const outside = withItems({ ...DAEJEON_ITEM, upperAddrName: '서울', noorLon: '126.978', noorLat: '37.5665' })
    const responses = [new Response(null, { status: 204 }), Response.json(withItems()), Response.json(outside)]
    for (const response of responses) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response)
      await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn })).resolves.toBeNull()
    }
    expect(console.error).not.toHaveBeenCalled()
  })

  it('요청뿐 아니라 본문 수신 중 시간 초과도 null로 처리하고 종류만 남긴다', async () => {
    vi.useFakeTimers()
    for (const bodyStalls of [false, true]) {
      vi.mocked(console.error).mockClear()
      const fetchFn = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
        const stalled = new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('테스트 중단', 'AbortError')), { once: true })
        })
        if (!bodyStalls) return stalled
        const response = new Response('{}')
        vi.spyOn(response, 'json').mockImplementation(() => stalled)
        return Promise.resolve(response)
      })
      const result = searchPoi('한밭수목원', { apiKey: KEY, fetchFn, timeoutMs: 25 })
      await vi.advanceTimersByTimeAsync(25)
      await expect(result).resolves.toBeNull()
      expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(console.error).toHaveBeenCalledWith('[geo]', 'POI 검색 실패', 'timeout')
    }
  })

  it('제한 시간이 잘못되어도 던지지 않고 외부 요청도 하지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(searchPoi('한밭수목원', { apiKey: KEY, fetchFn, timeoutMs: 0 })).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[geo]', 'POI 검색 실패', 'unknown')
  })
})
