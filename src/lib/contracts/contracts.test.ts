import { describe, expect, it } from 'vitest'
import {
  CoordSchema,
  JudgeResultSchema,
  legKey,
  OpinionInputSchema,
  OpinionSchema,
  PlaceSegmentSchema,
  StopSchema,
  TravelerSchema,
  TripVersionSchema,
  type JudgeResult,
  type LegRequest,
  type Opinion,
  type PlaceSegment,
  type Stop,
  type Traveler,
} from './index'

// 한밭수목원 기준 예시 데이터 (좌표는 예시값)
const segment: PlaceSegment = {
  id: 'hanbat-s3',
  placeId: 'hanbat',
  fromNodeId: 'rest-indoor',
  toNodeId: 'deck',
  order: 3,
  distanceM: 140,
  path: [
    [127.3846, 36.3688],
    [127.3836, 36.368],
  ],
  stairsStatus: 'present',
  stairsCount: 24,
  slope: false,
  optional: false,
  source: '한밭수목원 공식 안내도',
  checkedAt: '2026-11',
  confidence: 'A',
}

const nodeReq: LegRequest = {
  from: { placeId: 'hanbat', nodeId: 'exit', coord: [127.3848, 36.3672] },
  to: { placeId: 'science', nodeId: 'parking', coord: [127.3745, 36.3763] },
  mode: 'car',
}

const opinion: Opinion = {
  id: 'op1',
  versionId: 'v1',
  stopKey: 's1',
  userId: 'u-mom',
  userName: '엄마',
  reactions: ['too_far'],
  comment: '다리가 아파서 반만 보고 싶어',
  createdAt: '2026-11-01T10:00:00.000Z',
}

const traveler: Traveler = {
  id: 't1',
  label: '엄마',
  userId: 'u-mom',
  age: 72,
  heightCm: 156,
  sex: 'female',
  pace: 'slow',
  mobilityAid: false,
  condition: { continuousMin: 20, avoidStairs: true },
  filledBySelf: true,
}

const stop: Stop = {
  key: 's1',
  placeId: 'hanbat',
  name: '한밭수목원',
  startTime: '10:00',
  visitMin: 90,
  mustVisit: true,
  arriveBy: 'car',
  skipSegmentIds: [],
  detourMap: {},
  restNodeIds: [],
}

const judgeResult: JudgeResult = {
  verdict: 'adjust',
  reason: '한밭수목원 안에 계단 구간이 있어요',
  condition: { continuousMin: 20, dayMin: 60, restMin: 10, avoidStairs: true },
  speedMps: 0.85,
  day: { base: 50, high: 60 },
  longest: { base: 27, high: 32.4, fromStopKey: 's1', toStopKey: 's1' },
  restTotalMin: 0,
  stops: [
    {
      stopKey: 's1',
      placeId: 'hanbat',
      known: true,
      walk: { base: 27, high: 32.4 },
      segments: [
        {
          segmentId: 'hanbat-s3',
          label: '실내 쉼터 → 전망 데크',
          time: { base: 5.5, high: 6.6 },
          stairsStatus: 'present',
          stairsCount: 24,
          status: 'warn',
          source: '한밭수목원 공식 안내도',
          checkedAt: '2026-11',
          confidence: 'A',
        },
      ],
    },
  ],
  legs: [],
  violations: [{ kind: 'stairs', stopKey: 's1', segmentId: 'hanbat-s3', count: 24 }],
  unknownStopKeys: [],
  unrecordedStairs: [],
}

describe('Coord', () => {
  it('대전 [경도, 위도]는 통과', () => {
    expect(CoordSchema.parse([127.3845, 36.3504])).toEqual([127.3845, 36.3504])
  })
  it('[위도, 경도]로 뒤바뀌면 거부', () => {
    expect(CoordSchema.safeParse([36.3504, 127.3845]).success).toBe(false)
  })
})

describe('PlaceSegment', () => {
  it('예시 구간 통과', () => {
    expect(PlaceSegmentSchema.parse(segment)).toEqual(segment)
  })
  it('stairsStatus는 세 값만', () => {
    expect(PlaceSegmentSchema.safeParse({ ...segment, stairsStatus: 'none' }).success).toBe(false)
  })
  it('거리 음수 거부', () => {
    expect(PlaceSegmentSchema.safeParse({ ...segment, distanceM: -1 }).success).toBe(false)
  })
})

describe('legKey', () => {
  it('노드가 있으면 장소/노드로', () => {
    expect(legKey(nodeReq)).toBe('hanbat/exit>science/parking:car')
  })
  it('좌표는 소수점 5자리 반올림', () => {
    expect(
      legKey({ from: { coord: [127.380000001, 36.37] }, to: { coord: [127.38, 36.370000004] }, mode: 'walk' }),
    ).toBe('127.38000,36.37000>127.38000,36.37000:walk')
  })
  it('이동수단이 다르면 다른 키', () => {
    expect(legKey({ ...nodeReq, mode: 'taxi' })).not.toBe(legKey(nodeReq))
  })
})

describe('Opinion', () => {
  it('반응도 의견도 없으면 거부', () => {
    expect(OpinionSchema.safeParse({ ...opinion, reactions: [], comment: undefined }).success).toBe(false)
  })
  it('한 줄 의견만 있어도 통과', () => {
    expect(OpinionSchema.safeParse({ ...opinion, reactions: [], comment: '너무 멀어' }).success).toBe(true)
  })
  it('의견 101자 거부', () => {
    expect(OpinionSchema.safeParse({ ...opinion, comment: '가'.repeat(101) }).success).toBe(false)
  })
})

describe('OpinionInput (의견 남기기 요청 본문)', () => {
  it('반응도 의견도 없으면 거부', () => {
    expect(OpinionInputSchema.safeParse({ stopKey: 's1', reactions: [] }).success).toBe(false)
  })
  it('반응만 있어도 통과', () => {
    expect(OpinionInputSchema.parse({ stopKey: null, reactions: ['need_rest'] })).toEqual({
      stopKey: null,
      reactions: ['need_rest'],
    })
  })
})

describe('TripVersion (DB에서 비어 있는 칸)', () => {
  const version = {
    id: 'v1',
    tripId: 'trip1',
    number: 1,
    parentId: null,
    madeBy: 'user',
    stops: [stop],
    createdAt: '2026-11-01T10:00:00.000Z',
  }
  it('판정 요약·메모·만든 사람이 null이어도 통과 (엔진 연결 전 저장)', () => {
    expect(TripVersionSchema.safeParse({ ...version, summary: null, note: null, madeByUserId: null }).success).toBe(
      true,
    )
  })
  it('반영 버전이 null인 의견도 통과', () => {
    expect(OpinionSchema.safeParse({ ...opinion, appliedInVersionId: null }).success).toBe(true)
  })
})

describe('Traveler', () => {
  it('조건이 비어 있어도 통과 (잘 모르겠어요)', () => {
    expect(TravelerSchema.parse({ ...traveler, condition: {} }).condition).toEqual({})
  })
  it('나이 130 거부', () => {
    expect(TravelerSchema.safeParse({ ...traveler, age: 130 }).success).toBe(false)
  })
})

describe('Stop', () => {
  it('시간 형식 HH:mm만', () => {
    expect(StopSchema.safeParse({ ...stop, startTime: '10시' }).success).toBe(false)
  })
})

describe('JudgeResult', () => {
  it('예시 판정 결과 통과', () => {
    expect(JudgeResultSchema.parse(judgeResult)).toEqual(judgeResult)
  })
})
