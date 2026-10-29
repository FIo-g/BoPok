# 공통: 0단계 준비와 공용 타입 초안

모든 역할이 먼저 읽는 문서. 0단계가 끝나야 네 역할이 서로 기다리지 않고 동시에 갈 수 있다.

## 1. 0단계 — 함께 준비할 것

| 할 일 | 주도 | 완료 기준 |
| --- | --- | --- |
| 레포 초기화: Next.js 16 + TypeScript + Tailwind 4 + pnpm + eslint + vitest, `src/` 구조(설계 10.2), `.env.example` | 김경선 | `pnpm dev`, `pnpm test`, `pnpm build` 통과, main에 머지 |
| Neon 프로젝트 만들기, Drizzle 설정, 팀원별 Neon 브랜치 | 김경선 | 각자 `.env.local`의 `DATABASE_URL`로 접속됨 |
| Vercel 연결 (main 머지 시 배포, PR마다 미리보기) | 김경선 | PR 미리보기 URL이 뜸 |
| `src/lib/contracts` 확정 — 아래 3장 초안을 코드로 | 김태형(엔진·AI 타입), 이동주(장소·경로 타입), 김경선(그룹·여행·버전·의견 타입), 오하연(리뷰) | zod 스키마 + 타입, 네 명 모두 PR 승인 |
| 목업 데이터 `src/mocks` (한밭수목원 등 2~3곳, 버전 2개, 의견 몇 개) | 오하연 | 프론트가 API 없이 일정 화면을 그릴 수 있음 |

> 레포를 `create-next-app`으로 만들 때 이미 있는 `AGENTS.md`, `CLAUDE.md`, `docs/`와 충돌하면, 임시 폴더에 만들어 필요한 파일만 옮긴다. `pnpm dev`가 `AGENTS.md` 끝에 Next.js 안내 블록을 자동으로 붙이는데, 그대로 커밋해도 된다.

## 2. 환경 변수 (이름만, 값은 `.env.local`)

| 이름 | 쓰는 곳 |
| --- | --- |
| `DATABASE_URL` | Drizzle (Neon) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | 로그인 |
| `UPSTAGE_API_KEY` | AI (기본) |
| `OPENCODE_API_KEY` | AI (대체) |
| `TMAP_APP_KEY` | 경로·장소 검색 |
| `TOURAPI_SERVICE_KEY` | 관광지 목록 (데이터 스크립트만) |

이름은 0단계에서 바꿔도 되지만, 바꾸면 이 표와 `.env.example`을 같이 고친다.

## 3. 공용 타입 초안 (`src/lib/contracts`)

0단계에서 이 초안을 zod 스키마로 옮기며 확정한다. 단위: 거리 m, 시간 분, 속도 m/s, 좌표 `[경도, 위도]`.

```ts
// ── 기본 ──
type Coord = [number, number]
type Confidence = 'A' | 'B' | 'C'            // A 공식 안내·현장 확인 / B 지도에서 측정 / C 사진·후기 추정
type SourceInfo = { source?: string; checkedAt?: string; confidence: Confidence }
type StairsStatus = 'present' | 'confirmed_none' | 'unknown'
type Transport = 'walk' | 'car' | 'taxi' | 'bus'

// ── 사람과 조건 (김태형·김경선) ──
type Sex = 'female' | 'male'
type Pace = 'slow' | 'normal' | 'unknown'      // 본인이 답한 걷는 속도
type Condition = {
  continuousMin: number                        // 쉬지 않고 걸을 수 있는 시간
  dayMin: number                               // 하루 총 걷기
  restMin: number                              // 한 번 쉬는 시간
  avoidStairs: boolean
}
type Traveler = {
  id: string
  label: string                                // 엄마, 아빠, 나 …
  userId?: string                              // 그룹 구성원 계정과 연결되면
  age?: number
  heightCm?: number
  sex?: Sex
  pace: Pace
  mobilityAid: boolean                         // 지팡이·보행 보조기구
  condition: Partial<Condition>                // 비어 있으면 기본값 ('잘 모르겠어요')
  filledBySelf: boolean                        // 본인이 직접 채웠는지
}

// ── 장소 (이동주) ──
type PlaceNodeKind = 'parking' | 'stop' | 'entrance' | 'sight' | 'exit' | 'rest' | 'toilet'
type PlaceNode = { id: string; placeId: string; kind: PlaceNodeKind; name: string; restType: 'indoor' | 'outdoor' | null; coord: Coord }
type PlaceSegment = SourceInfo & {
  id: string; placeId: string; fromNodeId: string; toNodeId: string; order: number
  distanceM: number; path: Coord[]
  stairsStatus: StairsStatus; stairsCount?: number; slope: boolean
  optional: boolean                            // 꼭 보지 않아도 되는 구간 (수정안 A에서 뺄 수 있음)
  detourOf?: string                            // 이 구간이 어떤 계단 구간의 우회로인지
}
type PlaceSummary = SourceInfo & {
  id: string; name: string; category: string; styles: string[]; coord: Coord
  visitMin?: number                            // 홈페이지 기준 머무는 시간
  seated: boolean                              // 식사·카페·족욕처럼 앉아서 머무는 곳 → 연속 걷기 끊김
  indoor: boolean; address?: string; phone?: string; homepage?: string
}
type PlaceDetail = PlaceSummary & { nodes: PlaceNode[]; segments: PlaceSegment[] }

// ── 장소 사이 경로 (이동주) ──
type LegEnd = { placeId?: string; nodeId?: string; coord: Coord }
type LegRequest = { from: LegEnd; to: LegEnd; mode: Transport }
type Leg = SourceInfo & {
  key: string                                  // legKey(req) — contracts에 함수로 둔다
  mode: Transport; distanceM: number; durationMin?: number   // durationMin은 탈것만
  path: Coord[]; stairsStatus: StairsStatus; stairsCount?: number
  fareKrw?: number                             // 택시 추정 요금
}

// ── 일정 (김경선) ──
type Stop = {
  key: string                                  // 버전 안에서 고유. 의견이 여기에 붙는다
  placeId: string | null                       // null이면 DB에 없는 장소 (정보 없음)
  name: string; coord?: Coord
  startTime?: string                           // 'HH:mm'
  visitMin?: number
  seated?: boolean                             // placeId가 null일 때 직접 표시 (예: 점심)
  mustVisit: boolean; reservedAt?: string
  arriveBy: Transport                          // 이전 장소에서 여기로 오는 방법 (첫 장소는 출발 지점 선택에 씀)
  skipSegmentIds: string[]; detourMap: Record<string, string>; restNodeIds: string[]
}

// ── 판정 (김태형) ──
type Minutes = { base: number; high: number }
type Verdict = 'ok' | 'adjust' | 'info'
type Violation =
  | { kind: 'stairs'; stopKey: string | null; segmentId?: string; legKey?: string; count?: number }
  | { kind: 'continuous'; fromStopKey: string; toStopKey: string; over: number }
  | { kind: 'day'; over: number }
type JudgeInput = {
  travelers: Traveler[]; tuned?: Partial<Condition>
  stops: Stop[]
  places: Record<string, PlaceDetail>          // placeId → 상세
  legs: Record<string, Leg>                    // legKey → 경로
}
type JudgeResult = {
  verdict: Verdict; reason: string
  condition: Condition; speedMps: number       // 실제로 쓴 조건과 속도 (가장 느린 사람 기준)
  day: Minutes; longest: Minutes & { fromStopKey: string; toStopKey: string }
  restTotalMin: number
  stops: StopResult[]                          // 장소별 구간 결과 (지도·목록용)
  legs: LegResult[]
  violations: Violation[]
  unknownStopKeys: string[]                    // 장소 안 정보가 없는 곳
  unrecordedStairs: { segmentId?: string; legKey?: string }[]   // '계단 기록 없음' 구간 (배지 아래 n곳)
}
// StopResult, LegResult의 세부 필드는 김태형이 0단계에서 정한다 (구간별 시간 범위, 상태 ok|warn, 출처 포함).
type JudgeSummary = Pick<JudgeResult, 'verdict' | 'reason' | 'day' | 'longest'>

// ── 버전과 의견 (김경선) ──
type TripVersion = {
  id: string; tripId: string; number: number; parentId: string | null
  madeBy: 'user' | 'ai' | 'quick_fix'; madeByUserId?: string
  stops: Stop[]; summary?: JudgeSummary; note?: string; createdAt: string
}
type Reaction = 'too_far' | 'stairs_worry' | 'must_go' | 'need_rest' | 'prefer_other'
type Opinion = {
  id: string; versionId: string; stopKey: string | null   // null = 일정 전체 의견
  userId: string; userName: string; reactions: Reaction[]; comment?: string
  appliedInVersionId?: string; createdAt: string
}
```

## 4. 판정이 화면에 도착하는 길 (모두 알아 둘 흐름)

```
[브라우저 — 일정 화면]
  stops 바뀜 → engine.requiredLegs(stops, places) → 없는 경로만 POST /api/legs (이동주)
           → engine.judge(input) (김태형, 브라우저에서 바로) → 목록·요약·지도 갱신 (오하연)
  저장 → POST /api/trips/:id/versions (김경선) → 서버도 engine.judge로 요약 저장
  다시 짜기 → POST /api/ai/revise (김태형) → lib/trips.createVersion (김경선)
```

## 5. 합치는 순서 (설계 11장)

1. 가입 → 그룹 → 여행(장소 직접 고르기) → 판정 → 지도까지 한 바퀴 (AI 없이)
2. AI 인터뷰 + 붙여넣기(A) / 처음부터(B)
3. 의견 → 다시 짜기 → 버전 비교 → 확정 → 공유
