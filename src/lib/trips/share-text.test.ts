// 공유 글 형식 테스트. 장소·경로 API(이동주 PR #6·#7)가 아직 없으니 가짜 deps로 넣는다.
// 핵심은 '숫자는 engine.judge 결과에서만' 과 '모르면 지어내지 않는다'다 (AGENTS.md 6장).
import { describe, expect, it } from 'vitest'
import type { Leg, LegRequest, PlaceDetail, Trip, TripVersion } from '@/lib/contracts'
import { legKey } from '@/lib/contracts'
import { formatRange } from '@/lib/engine'
import { hanbat } from '@/lib/engine/test-fixtures'
import { stop, traveler } from '@/lib/auth/test-fixtures'
import { judgeStops } from './judge-run'
import type { PlaceGeoDeps } from './place-geo'
import { buildShareText } from './share-text'

const trip: Trip = {
  id: 'trip-1',
  groupId: 'group-1',
  title: '부모님과 대전',
  date: '2026-11-15',
  mode: 'scratch',
  transport: 'car',
  styles: [],
  budget: null,
  confirmedVersionId: 'v1',
  confirmedByName: '김경선',
  createdAt: '2026-11-01T00:00:00.000Z',
}

function versionOf(stops: TripVersion['stops']): TripVersion {
  return {
    id: 'v1',
    tripId: trip.id,
    number: 1,
    parentId: null,
    madeBy: 'user',
    madeByUserId: 'u1',
    stops,
    summary: null,
    note: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  }
}

const travelers = [traveler({ id: 't1', label: '엄마', isParent: true, age: 68, heightCm: 158, sex: 'female' })]

// 장소 하나(한밭수목원)와 탈것 구간을 아는 가짜 deps
function depsWith(place: PlaceDetail): PlaceGeoDeps {
  return {
    getPlaceDetails: async ids => (ids.includes(place.id) ? [place] : []),
    getLegs: async requests => requests.map(request => carLeg(request)),
  }
}

function carLeg(request: LegRequest): Leg {
  return {
    key: legKey(request),
    mode: request.mode,
    distanceM: 8000,
    durationMin: request.mode === 'walk' ? undefined : 15,
    path: [request.from.coord, request.to.coord],
    stairsStatus: 'unknown',
    confidence: 'C',
    source: '테스트용 가짜 값',
  }
}

// 장소·경로를 하나도 모르는 지금 상태 (이동주 API 미머지)
const noDataDeps: PlaceGeoDeps = { getPlaceDetails: async () => [], getLegs: async () => [] }

describe('공유 글 형식', () => {
  it('머리말·장소 순서·시간·하루 요약·안내 문구가 들어간다', async () => {
    const place = hanbat
    const stops = [
      stop({
        key: 's1',
        name: '한밭수목원',
        placeId: place.id,
        startTime: '10:00',
        reservedAt: '10:30',
        restNodeIds: [place.nodes.find(node => node.kind === 'rest')?.id ?? ''],
      }),
      stop({ key: 's2', name: '점심 (도롱이마을)', seated: true, startTime: '12:30', arriveBy: 'car' }),
    ]
    const version = versionOf(stops)
    const run = await judgeStops({ stops, travelers }, depsWith(place))
    const text = buildShareText({ trip, version, run })

    expect(text.startsWith('[보폭] 부모님과 대전\n2026-11-15 확정 일정')).toBe(true)
    expect(text).toContain('10:00 한밭수목원')
    expect(text).toContain('예약 10:30')
    expect(text).toContain('12:30 점심 (도롱이마을)')
    expect(text).toContain('출발 전 운영 여부를 꼭 확인하세요')
    // 장소 순서가 지켜진다
    expect(text.indexOf('한밭수목원')).toBeLessThan(text.indexOf('점심 (도롱이마을)'))
  })

  it('걷는 시간·하루 요약 숫자가 판정 결과와 똑같다 (서버가 따로 계산하지 않는다)', async () => {
    const place = hanbat
    const stops = [stop({ key: 's1', name: '한밭수목원', placeId: place.id, startTime: '10:00' })]
    const run = await judgeStops({ stops, travelers }, depsWith(place))
    const text = buildShareText({ trip, version: versionOf(stops), run })

    const stopResult = run.result?.stops.find(one => one.stopKey === 's1')
    expect(stopResult?.known).toBe(true)
    // 글에 적힌 숫자가 엔진이 준 값과 같은 문자열인지
    expect(text).toContain(`걷기 ${formatRange(stopResult!.walk)} · 추정치`)
    expect(text).toContain(`하루 걷기 ${formatRange(run.result!.day)}`)
    expect(text).toContain(`쉬지 않고 걷는 시간 최대 ${formatRange(run.result!.longest)} (추정치)`)
  })

  it('쉼터 이름과 종류(실내·야외)가 나온다', async () => {
    const place = hanbat
    const rest = place.nodes.find(node => node.restType !== null)
    expect(rest).toBeDefined()
    const stops = [stop({ key: 's1', name: '한밭수목원', placeId: place.id, restNodeIds: [rest!.id] })]
    const run = await judgeStops({ stops, travelers }, depsWith(place))
    const text = buildShareText({ trip, version: versionOf(stops), run })

    const typeText = rest!.restType === 'indoor' ? '(실내)' : '(야외)'
    expect(text).toContain(`${rest!.name}${typeText}에서 쉬기`)
  })

  it('탈것 구간은 "↓ 자가용 이동 약 n분"으로 나온다', async () => {
    const place = hanbat
    const stops = [
      stop({ key: 's1', name: '한밭수목원', placeId: place.id }),
      // 좌표가 있어야 '장소 사이 경로'가 필요하다고 엔진이 알려 준다 (좌표가 없으면 missingLegs)
      stop({ key: 's2', name: '대전시립미술관', arriveBy: 'car', coord: [127.385, 36.3315] }),
    ]
    const run = await judgeStops({ stops, travelers }, depsWith(place))
    const text = buildShareText({ trip, version: versionOf(stops), run })

    expect(text).toContain('↓ 자가용 이동 약 15분')
  })

  it('전화번호가 있는 장소는 연락처로 나온다', async () => {
    const place = { ...hanbat, phone: '042-270-8452' }
    const stops = [stop({ key: 's1', name: '한밭수목원', placeId: place.id })]
    const run = await judgeStops({ stops, travelers }, depsWith(place))
    const text = buildShareText({ trip, version: versionOf(stops), run })

    expect(text).toContain('한밭수목원 042-270-8452')
  })

  it('날짜가 없으면 "확정 일정"만 쓴다', async () => {
    const stops = [stop({ key: 's1', name: '한밭수목원' })]
    const run = await judgeStops({ stops, travelers }, noDataDeps)
    const text = buildShareText({ trip: { ...trip, date: null }, version: versionOf(stops), run })
    expect(text.split('\n')[1]).toBe('확정 일정')
  })
})

describe('정보가 없을 때 숫자를 지어내지 않는다', () => {
  it('장소 정보가 없으면 "길 정보 없음"이고 하루 요약은 "정보 부족"이다 (0분이 아니다)', async () => {
    const stops = [
      stop({ key: 's1', name: '한밭수목원', startTime: '10:00' }),
      stop({ key: 's2', name: '점심', arriveBy: 'car' }),
    ]
    const run = await judgeStops({ stops, travelers }, noDataDeps)
    const text = buildShareText({ trip, version: versionOf(stops), run })

    expect(text).toContain('길 정보 없음')
    expect(text).toContain('하루 걷기 정보 부족 (장소 정보가 모이면 알려드려요)')
    expect(text).not.toContain('약 0분')
    expect(text).not.toContain('0~0')
    // 장소 순서·시간·안내 문구는 그대로 나온다
    expect(text).toContain('10:00 한밭수목원')
    expect(text).toContain('출발 전 운영 여부를 꼭 확인하세요')
  })

  it('여행자가 없으면 판정을 아예 돌리지 않고 그렇게 밝힌다', async () => {
    const stops = [stop({ key: 's1', name: '한밭수목원', startTime: '10:00' })]
    const run = await judgeStops({ stops, travelers: [] }, noDataDeps)
    expect(run.result).toBeNull()

    const text = buildShareText({ trip, version: versionOf(stops), run })
    expect(text).toContain('하루 걷기 정보 부족 (함께 가는 사람을 입력하면 알려드려요)')
    expect(text).toContain('10:00 한밭수목원')
  })

  it('쉼터 정보가 없으면 그 줄을 넣지 않는다', async () => {
    const stops = [stop({ key: 's1', name: '한밭수목원', restNodeIds: ['no-such-node'] })]
    const run = await judgeStops({ stops, travelers }, noDataDeps)
    const text = buildShareText({ trip, version: versionOf(stops), run })
    expect(text).not.toContain('에서 쉬기')
  })

  it('"계단 없음"이라는 말을 쓰지 않는다 (confirmed_none일 때만 써야 하므로 이번엔 넣지 않았다)', async () => {
    const place = hanbat
    const stops = [stop({ key: 's1', name: '한밭수목원', placeId: place.id })]
    const run = await judgeStops({ stops, travelers }, depsWith(place))
    const text = buildShareText({ trip, version: versionOf(stops), run })
    expect(text).not.toContain('계단 없음')
  })
})
