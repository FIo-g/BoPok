import { describe, expect, it } from 'vitest'
import {
  AiErrorSchema,
  ApiErrorCodeSchema,
  BudgetSchema,
  CoordSchema,
  ExplainRequestSchema,
  ExplainResponseSchema,
  GenerateRequestSchema,
  INTERVIEW_SLOTS,
  InterviewAnswerSchema,
  InterviewFilledSchema,
  InterviewRequestSchema,
  InterviewResponseSchema,
  InterviewSlotSchema,
  InterviewStateSchema,
  JudgeResultSchema,
  legKey,
  MustVisitSchema,
  OpinionInputSchema,
  OpinionSchema,
  ParseScheduleRequestSchema,
  ParseScheduleResponseSchema,
  PendingConsentSchema,
  PlaceSegmentSchema,
  PlanResponseSchema,
  ReviseRequestSchema,
  ReviseResponseSchema,
  StartModeSchema,
  StopSchema,
  TravelerSchema,
  TravelStyleSchema,
  TripVersionSchema,
  AiFallbackSchema,
  type InterviewFilled,
  type InterviewState,
  type JudgeResult,
  type JudgeSummary,
  type LegRequest,
  type Opinion,
  type PlaceSegment,
  type Stop,
  type Traveler,
  type TripVersion,
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
  isParent: true,
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
  conditionFrom: { continuousMin: 'parent', dayMin: 'default', restMin: 'default', avoidStairs: 'parent' },
  speedTravelerId: 't1',
  pendingConsents: [],
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
          reverse: false,
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
  missingLegs: [],
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
  it('isParent 없으면 거부', () => {
    const rest: Partial<Traveler> = { ...traveler }
    delete rest.isParent
    expect(TravelerSchema.safeParse(rest).success).toBe(false)
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
  it('걷는 구간이 없으면 longest의 장소 키는 null', () => {
    const r = { ...judgeResult, longest: { base: 0, high: 0, fromStopKey: null, toStopKey: null } }
    expect(JudgeResultSchema.safeParse(r).success).toBe(true)
  })
  it('부모님 확인 제안 값은 분 또는 계단 피하기', () => {
    const minutes = { field: 'continuousMin', parentTravelerId: 't1', proposedValue: 90, fromTravelerId: 't3', askCreator: false }
    const stairs = { ...minutes, field: 'avoidStairs', proposedValue: false, askCreator: true }
    expect(JudgeResultSchema.safeParse({ ...judgeResult, pendingConsents: [minutes, stairs] }).success).toBe(true)
    expect(PendingConsentSchema.safeParse({ ...minutes, field: 'speed' }).success).toBe(false)
  })
  it('조건 출처는 정해진 다섯 가지만', () => {
    const bad = { ...judgeResult, conditionFrom: { ...judgeResult.conditionFrom, dayMin: 'ai' } }
    expect(JudgeResultSchema.safeParse(bad).success).toBe(false)
  })
  it('좌표 없는 장소의 빠진 경로는 legKey null', () => {
    const r = { ...judgeResult, missingLegs: [{ fromStopKey: 's1', toStopKey: 's2', legKey: null }] }
    expect(JudgeResultSchema.safeParse(r).success).toBe(true)
  })
})

// Task 4A — AI API 계약. 스키마마다 통과·거부 1개씩 둔다.
describe('AI 계약', () => {
  const filled: InterviewFilled = {
    mode: 'scratch',
    travelers: [traveler],
    date: '2026-11-14',
    startTime: '09:00',
    endTime: '18:00',
    transport: 'car',
    styles: ['자연·산책'],
    budget: '30k_50k',
    mustVisit: [{ name: '한밭수목원', reservedAt: '10:30' }],
    fixTargets: ['전체적으로 덜 걷게'],
  }
  const interviewState: InterviewState = {
    filled,
    cursor: { slot: 'travelers', travelerIndex: 0, questionIndex: 0 },
    history: [{ role: 'assistant', text: '함께 가시는 분을 알려 주세요.' }],
  }
  const summary: JudgeSummary = {
    verdict: 'ok',
    reason: '모든 구간이 부모님 조건에 맞아요',
    day: judgeResult.day,
    longest: judgeResult.longest,
  }
  const version: TripVersion = {
    id: 'v1',
    tripId: 'trip1',
    number: 1,
    parentId: null,
    madeBy: 'ai',
    madeByUserId: null,
    stops: [stop],
    summary,
    note: null,
    createdAt: '2026-11-01T10:00:00.000Z',
  }

  it('AiFallback: pick_places 통과, 밖의 값 거부', () => {
    expect(AiFallbackSchema.parse('pick_places')).toBe('pick_places')
    expect(AiFallbackSchema.safeParse('pick').success).toBe(false)
  })
  it('AiError: fallback이 있어도 통과, 이름 밖 코드는 거부', () => {
    expect(AiErrorSchema.parse({ error: { code: 'ai_failed', message: 'AI를 잠깐 못 썼어요', fallback: 'retry_or_pick' } }).error.fallback).toBe('retry_or_pick')
    expect(AiErrorSchema.safeParse({ error: { code: 'timeout', message: 'x' } }).success).toBe(false)
  })
  it('Budget: 50k_100k 통과, 예산 밖 값 거부', () => {
    expect(BudgetSchema.parse('50k_100k')).toBe('50k_100k')
    expect(BudgetSchema.safeParse('cheap').success).toBe(false)
  })
  it('StartMode: paste 통과, 갈래 A/B 값은 거부', () => {
    expect(StartModeSchema.parse('paste')).toBe('paste')
    expect(StartModeSchema.safeParse('A').success).toBe(false)
  })
  it('TravelStyle: 30자까지 통과, 31자 거부', () => {
    expect(TravelStyleSchema.parse('자연·산책')).toBe('자연·산책')
    expect(TravelStyleSchema.safeParse('가'.repeat(31)).success).toBe(false)
  })
  it('InterviewSlot: 정해진 칸 통과, 없는 칸 거부', () => {
    expect(INTERVIEW_SLOTS).toContain('traveler_condition_gate')
    expect(InterviewSlotSchema.parse('travelers')).toBe('travelers')
    expect(InterviewSlotSchema.safeParse('travelers2').success).toBe(false)
  })
  it('InterviewAnswer: 선택 하나만 있으면 통과, 선택과 글이 모두 없으면 거부', () => {
    expect(InterviewAnswerSchema.safeParse({ choiceIndex: 2 })).toEqual({ success: true, data: { choiceIndex: 2 } })
    expect(InterviewAnswerSchema.safeParse({}).success).toBe(false)
  })
  it('MustVisit: 예약 시간이 없어도 통과, HH:mm이 아닌 예약은 거부', () => {
    expect(MustVisitSchema.parse({ name: '한밭수목원' })).toEqual({ name: '한밭수목원' })
    expect(MustVisitSchema.safeParse({ name: '한밭수목원', reservedAt: '10시' }).success).toBe(false)
  })
  it('InterviewFilled: 채운 칸 통과, 이동수단 walk는 인터뷰 값이 아니라 거부', () => {
    expect(InterviewFilledSchema.parse(filled).mode).toBe('scratch')
    expect(InterviewFilledSchema.safeParse({ ...filled, transport: 'walk' }).success).toBe(false)
  })
  it('InterviewFilled: 없는 날짜는 정규식을 통과해도 거부', () => {
    expect(InterviewFilledSchema.safeParse({ ...filled, date: '2026-99-99' }).success).toBe(false)
    expect(InterviewFilledSchema.safeParse({ ...filled, date: '2026-11-14' }).success).toBe(true)
  })
  it('ApiErrorCode: internal_error 통과', () => {
    expect(ApiErrorCodeSchema.parse('internal_error')).toBe('internal_error')
  })
  it('InterviewState: 커서·기록 통과, 없는 칸 커서는 거부', () => {
    expect(InterviewStateSchema.parse(interviewState).cursor.slot).toBe('travelers')
    expect(InterviewStateSchema.safeParse({ ...interviewState, cursor: { ...interviewState.cursor, slot: 'date2' } }).success).toBe(false)
  })
  it('InterviewRequest: 답 없이도 통과, 범위 밖 선택은 거부', () => {
    expect(InterviewRequestSchema.parse({ tripId: 'trip1' })).toEqual({ tripId: 'trip1' })
    expect(InterviewRequestSchema.safeParse({ tripId: 'trip1', answer: { choiceIndex: -1 } }).success).toBe(false)
  })
  it('InterviewResponse: 정해진 칸 슬롯 통과, 밖의 슬롯은 거부', () => {
    expect(
      InterviewResponseSchema.parse({ text: '질문', choices: ['엄마·아빠·나'], slot: 'travelers', done: false, filled, questionId: 'travelers:0:0' }),
    ).toEqual({ text: '질문', choices: ['엄마·아빠·나'], slot: 'travelers', done: false, filled, questionId: 'travelers:0:0' })
    expect(
      InterviewResponseSchema.safeParse({ text: '질문', choices: [], slot: 'ask', done: false, filled }).success,
    ).toBe(false)
  })
  it('InterviewResponse: questionId가 없으면 거부', () => {
    expect(
      InterviewResponseSchema.safeParse({ text: '질문', choices: [], slot: 'done', done: true, filled }).success,
    ).toBe(false)
    expect(
      InterviewResponseSchema.parse({ text: '다 됐어요. 이제 일정을 짜 볼게요.', choices: [], slot: 'done', done: true, filled, questionId: 'done:0:0' }).questionId,
    ).toBe('done:0:0')
  })
  it('ParseScheduleRequest: 붙여넣은 글 통과, 빈 글은 거부', () => {
    expect(ParseScheduleRequestSchema.parse({ tripId: 'trip1', text: '10:00 한밭수목원' }).text).toBe('10:00 한밭수목원')
    expect(ParseScheduleRequestSchema.safeParse({ tripId: 'trip1', text: '   ' }).success).toBe(false)
  })
  it('ParseScheduleResponse: 정류장·못 맞춘 이름 통과, arriveBy 밖 값은 거부', () => {
    expect(ParseScheduleResponseSchema.parse({ stops: [stop], unmatched: ['둔산 카페'] }).stops).toEqual([stop])
    expect(ParseScheduleResponseSchema.safeParse({ stops: [{ ...stop, arriveBy: 'subway' }], unmatched: [] }).success).toBe(false)
  })
  it('GenerateRequest: tripId만 통과, 비어 있으면 거부', () => {
    expect(GenerateRequestSchema.parse({ tripId: 'trip1' })).toEqual({ tripId: 'trip1' })
    expect(GenerateRequestSchema.safeParse({ tripId: '' }).success).toBe(false)
  })
  it('PlanResponse: 버전과 요약 통과, madeBy 밖 값은 거부', () => {
    expect(PlanResponseSchema.parse({ version, summary }).version.madeBy).toBe('ai')
    expect(PlanResponseSchema.safeParse({ version: { ...version, madeBy: 'robot' }, summary }).success).toBe(false)
  })
  it('ReviseRequest: tripId·versionId 통과, versionId가 없으면 거부', () => {
    expect(ReviseRequestSchema.parse({ tripId: 'trip1', versionId: 'v1' })).toEqual({ tripId: 'trip1', versionId: 'v1' })
    expect(ReviseRequestSchema.safeParse({ tripId: 'trip1' }).success).toBe(false)
  })
  it('ReviseResponse: 반영 의견 id 통과, 그 칸이 없으면 거부', () => {
    expect(ReviseResponseSchema.parse({ version, summary, appliedOpinionIds: ['op1'] }).appliedOpinionIds).toEqual(['op1'])
    expect(ReviseResponseSchema.safeParse({ version, summary }).success).toBe(false)
  })
  it('ExplainRequest: 앞·뒤 판정 통과, 뒤 판정이 없으면 거부', () => {
    const next: JudgeResult = { ...judgeResult, verdict: 'ok' }
    expect(ExplainRequestSchema.parse({ tripId: 'trip1', prev: judgeResult, next })).toEqual({ tripId: 'trip1', prev: judgeResult, next })
    expect(ExplainRequestSchema.safeParse({ tripId: 'trip1', prev: judgeResult }).success).toBe(false)
  })
  it('ExplainResponse: ai·fixed 둘 통과, 밖의 출처는 거부', () => {
    expect(ExplainResponseSchema.parse({ text: '계단을 우회했어요', source: 'fixed' })).toEqual({ text: '계단을 우회했어요', source: 'fixed' })
    expect(ExplainResponseSchema.safeParse({ text: 'x', source: 'guess' }).success).toBe(false)
  })
})
