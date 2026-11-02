# 범위 확장 1단계 — 공용 타입 초안 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 4장의 새 공용 타입(zod 스키마 + 타입 + 작은 순수 도우미)을 `src/lib/contracts`에 넣어, 2단계에서 4명이 목업으로 동시에 구현할 수 있게 한다.

**Architecture:** 기존 파일(`place.ts`, `trip.ts`, `trip-api.ts`, `ai.ts`)에는 **선택 칸만** 더하고, 새 영역은 새 파일(`health.ts`, `chat.ts`, `feedback.ts`, `cost.ts`)로 나눠 `index.ts`에서 내보낸다. 기존 데이터·화면·엔진 코드는 한 줄도 바뀌지 않아야 한다(새 칸이 모두 optional이라 타입 오류가 나지 않음). 기능 구현(엔진 `dietCautions`, API, 화면, DB, 인터뷰 질문, `searchCandidates`의 `query`, `.env.example`의 Claude 키, 공용 문장 검사)은 이 계획에 없다 — 2단계.

**Tech Stack:** TypeScript, zod 4, vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-11-02-bopok-scope-expansion-design.md` 4장 (MVP 설계 `2026-10-29-bopok-mvp-design.md`와 함께 읽는다)

## Global Constraints

- 브랜치 `ai/contracts-expansion`을 `ai/demo-bugfix` 위에 만든다(설계 문서가 그 브랜치에 있음). `ai/demo-bugfix`가 main에 머지되면 main 위로 rebase한다.
- 커밋 작성자 `KIM, TAEHYEONG <xogud0710@korea.ac.kr>`, 커밋 메시지 한국어 `종류(contracts): 내용`, Claude 관련 줄 넣지 않음.
- **새 칸은 모두 `.optional()`** 이다. `.default()`를 쓰지 않는다 — zod 4에서 default는 출력 타입을 필수로 만들어 `Stop`·`PlaceSummary`를 만드는 기존 코드가 모두 타입 오류가 난다. "기본값"은 도우미 함수(`stopDay`, `placeKindOf`)가 정한다.
- 단위는 이름 끝에(`priceKrw`, `altitudeM`, `rotationDeg`), 좌표는 `[경도, 위도]` (`CoordSchema`).
- 장소·주의 데이터에는 출처·확인 날짜·신뢰 등급을 붙인다 → `SourceInfoSchema.extend(...)`. 주의 규칙(`DietRule`)과 주의 결과(`DietCaution`)는 `source`·`checkedAt`가 **필수**다(설계 7장 "근거 없는 '괜찮아요' 금지").
- `any` 금지, 주석은 "왜"를 한국어로 짧게, 파일 맨 위 주석에 주인과 리뷰 대상(AGENTS 3장 형식).
- `src/lib/contracts` 밖의 파일은 고치지 않는다(이 계획은 공용 타입만).
- 각 Task 끝에 `pnpm exec vitest run src/lib/contracts`가 통과해야 하고, 마지막 Task에서 `pnpm lint && pnpm test && pnpm build` 전체가 통과해야 한다.
- PR 리뷰어(나중에 push할 때): 오하연 `aress7578-lgtm`, 김경선 `gyeongseon-k`, 이동주 `DongJuLee54` (contracts는 모두의 것, AGENTS 3장).

## Review Focus

1. **"본인만" 건강 정보가 다른 가족에게 보이는 것** — `canSeeHealth`가 계정 없는 여행자(할머니)일 때 대신 입력한 사람만 `true`, 그 밖의 사람은 `false`여야 한다. Task 4에 테스트.
2. **동의 없이 건강 정보 저장** — `TravelerHealthInputSchema`는 `consent: true`가 없으면 거부. Task 4에 테스트.
3. **끝 날짜가 시작 날짜보다 앞선 여행** — 생성·수정 요청에서 거부(400). Task 2에 테스트.
4. **기존 저장 데이터(새 칸 없음)** — 지금의 `Stop`·`PlaceDetail`·`ReviseRequest` 모양이 그대로 통과하고, `stopDay`는 1, `placeKindOf`는 `attraction`. Task 1·2·5에 테스트.
5. **잘못된 도형·숫자** — 꼭짓점 3개 미만 구역, 1~5 밖 만족도, 낮은 값이 높은 값보다 큰 비용 범위는 거부. Task 1·3·6에 테스트.

---

### Task 1: 장소 종류와 장소 안 안내도 (`place.ts`)

**Files:**
- Modify: `src/lib/contracts/place.ts`
- Test: `src/lib/contracts/place-expansion.test.ts` (새 파일)

**Interfaces:**
- Produces (모두 `place.ts`에서 export):
  - `PlaceKindSchema = z.enum(['attraction', 'restaurant', 'cafe', 'lodging'])`, `type PlaceKind`
  - `placeKindOf(place: Pick<PlaceSummary, 'kind'>): PlaceKind` — `kind`가 없으면 `'attraction'`
  - ~~`PlaceNodeKindSchema`에 `'smoking'` 추가~~ — 11/2 김태형 결정으로 뺌(건강을 위한 서비스라 흡연장은 안내하지 않음). 기존 7개 그대로
  - `PlaceNodeSchema`에 `floor?: number(int)`(1=1층, -1=지하 1층), `guideNo?: number(int ≥ 1)`(안내도 번호)
  - `PlaceSegmentSchema`에 `courseId?: string`
  - `PlaceCourseSchema = SourceInfoSchema.extend({ id, name: min(1), recommended: boolean })`, `type PlaceCourse`
  - `PlaceZoneSchema = { id, name: min(1), floor: int, polygon: CoordSchema[] min(3) }`, `type PlaceZone`
  - `PlaceModelSchema = { url: string min(1), anchor: CoordSchema, rotationDeg: number(-360~360), scale: number > 0, altitudeM: number }`, `type PlaceModel`
  - `FoodTagSchema = z.enum(['sugary', 'salty', 'fatty', 'alcohol', 'grapefruit', 'leafy_greens'])`, `type FoodTag` (주석: 주의 규칙 표와 함께 늘린다)
  - `MenuItemSchema = SourceInfoSchema.extend({ name: min(1), priceKrw?: int ≥ 0, foodTags: FoodTag[] })`, `type MenuItem`
  - `PlaceSummarySchema`에 `kind?: PlaceKind`
  - `PlaceDetailSchema`에 `courses?: PlaceCourse[]`, `zones?: PlaceZone[]`, `model?: PlaceModel`, `menus?: MenuItem[]` (목록 응답이 커지지 않게 상세에만)

- [ ] **Step 1: 실패하는 테스트 쓰기** — `place-expansion.test.ts`

```ts
describe('장소 종류', () => {
  it('kind 없는 기존 장소는 관광지로 본다', () => {
    expect(placeKindOf({})).toBe('attraction')
    expect(placeKindOf({ kind: 'cafe' })).toBe('cafe')
  })
  it('모르는 종류는 거부', () => {
    expect(PlaceKindSchema.safeParse('bar').success).toBe(false)
  })
})
describe('장소 안 안내도', () => {
  it('흡연장 지점과 층·안내도 번호', () => {
    const node = { id: 'n1', placeId: 'aq', kind: 'smoking', name: '흡연 구역', restType: null, coord: [127.38, 36.35], floor: -1, guideNo: 3 }
    expect(PlaceNodeSchema.safeParse(node).success).toBe(true)
    expect(PlaceNodeSchema.safeParse({ ...node, guideNo: 0 }).success).toBe(false)
  })
  it('구역은 꼭짓점 3개 이상', () => {
    const zone = { id: 'z1', name: '1층 전시실', floor: 1, polygon: [[127.38, 36.35], [127.381, 36.35], [127.381, 36.351]] }
    expect(PlaceZoneSchema.safeParse(zone).success).toBe(true)
    expect(PlaceZoneSchema.safeParse({ ...zone, polygon: zone.polygon.slice(0, 2) }).success).toBe(false)
  })
  it('모형 크기는 0보다 커야 한다', () => {
    const model = { url: '/models/aq.glb', anchor: [127.38, 36.35], rotationDeg: 90, scale: 1, altitudeM: 0 }
    expect(PlaceModelSchema.safeParse(model).success).toBe(true)
    expect(PlaceModelSchema.safeParse({ ...model, scale: 0 }).success).toBe(false)
  })
  it('코스·메뉴에는 신뢰 등급이 필요', () => {
    expect(PlaceCourseSchema.safeParse({ id: 'c1', name: '동원', recommended: true }).success).toBe(false)
    expect(MenuItemSchema.safeParse({ name: '팥빙수', priceKrw: 9000, foodTags: ['sugary'], confidence: 'B' }).success).toBe(true)
    expect(MenuItemSchema.safeParse({ name: '팥빙수', foodTags: ['spicy'], confidence: 'B' }).success).toBe(false)
  })
  it('새 칸이 없는 기존 장소 상세도 그대로 통과', () => {
    // contracts.test.ts 의 기존 PlaceDetail 모양(nodes·segments만)을 그대로 넣는다
    expect(PlaceDetailSchema.safeParse(existingDetail).success).toBe(true)
  })
})
```

`existingDetail`은 테스트 파일 안에 지금 `PlaceDetailSchema`를 통과하는 최소 객체(새 칸 없음)로 둔다.

- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/lib/contracts/place-expansion.test.ts` → import 오류(`placeKindOf` 등 없음)로 FAIL
- [ ] **Step 3: `place.ts`에 위 Interfaces 그대로 구현** — 기존 스키마는 `.extend`로 칸만 더하고 순서·이름을 바꾸지 않는다
- [ ] **Step 4: 통과 확인** — `pnpm exec vitest run src/lib/contracts` → PASS (기존 contracts 테스트 포함)
- [ ] **Step 5: 커밋** — `git add src/lib/contracts/place.ts src/lib/contracts/place-expansion.test.ts && git commit -m "feat(contracts): 장소 종류·흡연장·안내도 번호·층·코스·구역·모형·메뉴 칸"`

---

### Task 2: 여러 날 여행 (`trip.ts`, `trip-api.ts`, `ai.ts`)

**Files:**
- Modify: `src/lib/contracts/trip.ts`, `src/lib/contracts/trip-api.ts`, `src/lib/contracts/ai.ts:92-108`
- Test: `src/lib/contracts/trip-days.test.ts` (새 파일)

**Interfaces:**
- Produces:
  - `StopSchema`에 `day?: number(int ≥ 1)` (주석: 없으면 1일차)
  - `stopDay(stop: Pick<Stop, 'day'>): number` — `day ?? 1`
  - `stopsOfDay(stops: Stop[], day: number): Stop[]` — 순서를 지키며 그날 것만
  - `tripDays(stops: Pick<Stop, 'day'>[]): number[]` — 나오는 날짜 번호를 오름차순·중복 없이(빈 일정이면 `[]`)
  - `TripSchema`에 `endDate: DateSchema.nullish()` (주석: `date`는 시작일)
  - `InterviewFilledSchema`에 `endDate?`(지금 `date`와 같은 형식·달력 검사) — 인터뷰 날짜 칸이 기간을 받는다(설계 4.2). 질문 문구와 칸 채우기 동작은 2단계(`src/lib/ai/interview.ts`)
  - `CreateTripRequestSchema`, `UpdateTripRequestSchema`에 `endDate`(각각 지금 `date`와 같은 nullish/nullable 규칙) + `endDate`가 `date`보다 앞서면 거부하는 `refine` (메시지 `'끝 날짜가 시작 날짜보다 빨라요'`, path `['endDate']`)

- [ ] **Step 1: 실패하는 테스트 쓰기** — `trip-days.test.ts`

```ts
it('day 없는 기존 장소는 1일차', () => {
  expect(stopDay({})).toBe(1)
  expect(stopDay({ day: 2 })).toBe(2)
  expect(StopSchema.safeParse({ ...stop, day: 0 }).success).toBe(false)
})
it('날짜별로 나누고 순서를 지킨다', () => {
  const stops = [{ ...stop, key: 'a' }, { ...stop, key: 'b', day: 2 }, { ...stop, key: 'c', day: 1 }]
  expect(stopsOfDay(stops, 1).map(s => s.key)).toEqual(['a', 'c'])
  expect(tripDays(stops)).toEqual([1, 2])
  expect(tripDays([])).toEqual([])
})
it('끝 날짜가 시작보다 빠르면 거부, 같거나 늦으면 통과', () => {
  const base = { groupId: 'g1', title: '대전 1박 2일', mode: 'scratch', styles: [] }
  expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14', endDate: '2026-11-13' }).success).toBe(false)
  expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14', endDate: '2026-11-15' }).success).toBe(true)
  expect(CreateTripRequestSchema.safeParse({ ...base, date: '2026-11-14' }).success).toBe(true)
})
it('인터뷰도 끝 날짜를 받고 없는 날짜는 거부', () => {
  const filled = { mode: 'scratch', travelers: [], styles: [], mustVisit: [], fixTargets: [] }
  expect(InterviewFilledSchema.safeParse({ ...filled, date: '2026-11-14', endDate: '2026-11-15' }).success).toBe(true)
  expect(InterviewFilledSchema.safeParse({ ...filled, endDate: '2026-02-31' }).success).toBe(false)
})
```

`stop`은 `contracts.test.ts`의 Stop 예시와 같은 최소 객체를 이 파일에 둔다. `base`는 지금 `CreateTripRequestSchema`가 요구하는 칸에 맞춘다(구현 전에 스키마를 읽고 맞출 것).

- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/lib/contracts/trip-days.test.ts` → FAIL
- [ ] **Step 3: 구현** — 도우미 3개는 `trip.ts`에, `endDate`와 refine은 `trip-api.ts`에. refine을 붙이면 `.pick`/`.extend`를 쓰는 다른 코드가 깨지는지(zod 4는 refine 뒤 pick 불가) `grep -rn "CreateTripRequestSchema\|UpdateTripRequestSchema" src`로 확인하고, 깨지면 `version.ts`의 `OpinionBaseSchema`처럼 규칙 없는 기본 모양을 따로 둔다
- [ ] **Step 4: 통과 확인** — `pnpm exec vitest run src/lib/contracts` → PASS
- [ ] **Step 5: 커밋** — `feat(contracts): 여러 날 여행 (Stop.day, Trip.endDate, 날짜별 도우미)`

---

### Task 3: 일차별 만족도 (`feedback.ts`)

**Files:**
- Create: `src/lib/contracts/feedback.ts`; Modify: `src/lib/contracts/index.ts` (`export * from './feedback'`)
- Test: `src/lib/contracts/feedback.test.ts`

**Interfaces:**
- Produces:
  - `DayFeedbackSchema = { tripId, day: int ≥ 1, userId, score: int 1~5, comment?: string trim max(100), createdAt: string }`, `type DayFeedback`
  - `DayFeedbackInputSchema = DayFeedbackSchema.pick({ day, score, comment })` (요청 본문), `type DayFeedbackInput`
  - 주석: 묻는 항목은 [2단계] — 지금은 점수 하나와 한 줄(의견과 같은 100자)

- [ ] **Step 1: 실패하는 테스트** — score `0`·`6`·`3.5` 거부, `1`·`5` 통과, `day: 0` 거부, comment 101자 거부
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/lib/contracts/feedback.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm exec vitest run src/lib/contracts` → PASS
- [ ] **Step 5: 커밋** — `feat(contracts): 일차별 만족도`

---

### Task 4: 건강 정보와 식단 주의 (`health.ts`)

**Files:**
- Create: `src/lib/contracts/health.ts`; Modify: `src/lib/contracts/index.ts`
- Test: `src/lib/contracts/health.test.ts`

**Interfaces:**
- Consumes: `FoodTagSchema` (Task 1), `SourceInfoSchema` (common)
- Produces:
  - `HealthConditionSchema = z.enum(['diabetes', 'hypertension', 'dyslipidemia', 'kidney_disease', 'gout', 'heart_disease'])`
  - `MedicationClassSchema = z.enum(['anticoagulant', 'calcium_channel_blocker'])` (주석: 최종 목록은 주의 규칙 표와 함께 [빌더])
  - `HealthVisibilitySchema = z.enum(['group', 'self'])`
  - `TravelerHealthSchema = { travelerId, conditions: HealthCondition[], medicationClasses: MedicationClass[], visibility, consentAt: z.iso.datetime(), enteredByUserId: string }`, `type TravelerHealth`
  - `TravelerHealthInputSchema = { conditions, medicationClasses, visibility, consent: z.literal(true) }` (요청 본문 — 동의 없으면 거부, 설계 4.4)
  - `canSeeHealth(health: Pick<TravelerHealth, 'visibility' | 'enteredByUserId'>, viewerUserId: string, travelerUserId?: string): boolean` — `group`이면 `true`; `self`면 `viewerUserId === (travelerUserId ?? health.enteredByUserId)`
  - `DietRuleSchema` = `SourceInfoSchema.extend({ id, foodTag: FoodTag, sentence: min(1), source: min(1), checkedAt: min(1) })`에 `z.discriminatedUnion('reasonKind', [{ reasonKind: 'condition', condition: HealthCondition }, { reasonKind: 'medication', medicationClass: MedicationClass }])`를 합친 모양, `type DietRule`
  - `DietCautionSchema = { stopKey, menuName?: string, foodTag, travelerId, reasonKind: 'condition' | 'medication', reason: string, sentence: min(1), source: min(1), checkedAt: min(1) }`, `type DietCaution`
  - 파일 맨 위 주석: 민감정보(설계 4.4·7장) — 약봉투 사진은 이 타입 어디에도 두지 않는다, 여행자 정보와 다른 테이블, 서버가 `canSeeHealth`로 걸러서 내려준다

- [ ] **Step 1: 실패하는 테스트**

```ts
const self = { visibility: 'self', enteredByUserId: 'u-son' } as const
it('가족 모두면 누구나 본다', () => {
  expect(canSeeHealth({ ...self, visibility: 'group' }, 'u-daughter', 'u-mom')).toBe(true)
})
it('본인만 + 계정 있는 여행자는 그 사람만', () => {
  expect(canSeeHealth(self, 'u-mom', 'u-mom')).toBe(true)
  expect(canSeeHealth(self, 'u-son', 'u-mom')).toBe(false) // 대신 입력했어도 계정 있는 본인이 우선
})
it('본인만 + 계정 없는 여행자(할머니)는 대신 입력한 사람만', () => {
  expect(canSeeHealth(self, 'u-son')).toBe(true)
  expect(canSeeHealth(self, 'u-daughter')).toBe(false)
})
it('동의 없이 저장 요청은 거부', () => {
  const body = { conditions: ['diabetes'], medicationClasses: [], visibility: 'self' }
  expect(TravelerHealthInputSchema.safeParse(body).success).toBe(false)
  expect(TravelerHealthInputSchema.safeParse({ ...body, consent: false }).success).toBe(false)
  expect(TravelerHealthInputSchema.safeParse({ ...body, consent: true }).success).toBe(true)
})
it('목록 밖 병은 거부', () => {
  expect(HealthConditionSchema.safeParse('cold').success).toBe(false)
})
it('주의 규칙·결과는 출처와 확인 날짜가 꼭 있다', () => {
  const rule = { id: 'r1', reasonKind: 'condition', condition: 'diabetes', foodTag: 'sugary', sentence: '단 음식은 혈당을 빠르게 올립니다', source: '질병관리청', checkedAt: '2026-11', confidence: 'A' }
  expect(DietRuleSchema.safeParse(rule).success).toBe(true)
  expect(DietRuleSchema.safeParse({ ...rule, source: undefined }).success).toBe(false)
  expect(DietRuleSchema.safeParse({ ...rule, reasonKind: 'medication' }).success).toBe(false) // medicationClass 없음
})
```

- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/lib/contracts/health.test.ts` → FAIL
- [ ] **Step 3: 구현** — `DietRuleSchema`는 공통 칸 객체와 discriminatedUnion을 `z.intersection`(또는 각 갈래에 공통 칸을 `extend`)으로 합친다. 타입이 `reasonKind`로 좁혀지는지 테스트 파일에서 한 번 쓰는 것으로 확인
- [ ] **Step 4: 통과 확인** — `pnpm exec vitest run src/lib/contracts` → PASS
- [ ] **Step 5: 커밋** — `feat(contracts): 건강 정보·보이는 범위·식단 주의 규칙과 결과`

---

### Task 5: 그룹 채팅과 다시 짜기 연결 (`chat.ts`, `ai.ts`)

**Files:**
- Create: `src/lib/contracts/chat.ts`; Modify: `src/lib/contracts/index.ts`, `src/lib/contracts/ai.ts:171-174`
- Test: `src/lib/contracts/chat.test.ts`

**Interfaces:**
- Produces:
  - `CHAT_TEXT_MAX = 500`
  - `ChatMessageSchema = { id, tripId, userId, userName: string, text: min(1) max(CHAT_TEXT_MAX), createdAt: string }`, `type ChatMessage`
  - `ChatPostRequestSchema = { text: z.string().trim().min(1).max(CHAT_TEXT_MAX) }`
  - `ChatListQuerySchema = { after: z.string().optional() }` (주석: 이 시각 뒤의 글만 — 주기적 갱신용, 주기는 [2단계])
  - `ReviseRequestSchema`에 `includeChat: z.boolean().optional()` (주석: 없으면 false, 설계 4.5 "AI에게 전달하기")

- [ ] **Step 1: 실패하는 테스트** — 공백뿐인 글·501자 거부, 500자 통과, 앞뒤 공백은 잘림; 기존 `{ tripId, versionId }`만 있는 다시 짜기 요청이 그대로 통과하고 `includeChat: true`도 통과
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/lib/contracts/chat.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm exec vitest run src/lib/contracts src/lib/ai` → PASS (`ReviseRequestSchema`를 쓰는 AI 테스트 포함)
- [ ] **Step 5: 커밋** — `feat(contracts): 그룹 채팅, 다시 짜기에 채팅 넘기기 칸`

---

### Task 6: 비용 추정 (`cost.ts`)

**Files:**
- Create: `src/lib/contracts/cost.ts`; Modify: `src/lib/contracts/index.ts`
- Test: `src/lib/contracts/cost.test.ts`

**Interfaces:**
- Produces:
  - `CostItemKindSchema = z.enum(['admission', 'meal', 'taxi', 'lodging', 'other'])`
  - `CostItemSchema = { stopKey: string.nullable(), kind, krw: int ≥ 0 }` (택시는 도착 장소의 stopKey)
  - `CostEstimateSchema = { perPersonKrw: { low: int ≥ 0, high: int ≥ 0 }, items: CostItem[], bufferRate: number 0~1 }` + `low <= high` refine (path `['perPersonKrw']`), `type CostEstimate`
  - 주석: 여유 비율·담당 폴더는 [2단계]

- [ ] **Step 1: 실패하는 테스트** — `low > high` 거부, `bufferRate` `-0.1`·`1.5` 거부, 음수·소수 원 거부, 정상 예시 통과
- [ ] **Step 2: 실패 확인** — `pnpm exec vitest run src/lib/contracts/cost.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm exec vitest run src/lib/contracts` → PASS
- [ ] **Step 5: 커밋** — `feat(contracts): 비용 추정`

---

### Task 7: 전체 검사와 넘겨주기

**Files:** 없음 (검사·문서)

- [ ] **Step 1: 전체 검사** — `pnpm lint && pnpm test && pnpm build` → 모두 통과, 기존 테스트 수가 줄지 않음
- [ ] **Step 2: 다른 코드가 안 바뀌었는지** — `git diff --stat ai/demo-bugfix..HEAD -- . ':!src/lib/contracts' ':!docs'` → 출력 없음
- [ ] **Step 3: 설계 문서에 구현된 이름 반영** — `docs/superpowers/specs/2026-11-02-bopok-scope-expansion-design.md` 4장에서 이름이 달라진 곳(예: `includeChat`, `CHAT_TEXT_MAX`, `day`가 optional인 이유)을 고친다. 커밋 `docs: 공용 타입 이름을 설계 문서에 반영`
- [ ] **Step 4: 패치를 사용자에게 보낸다** — `git format-patch origin/main --stdout > <scratchpad>/ai-contracts-expansion.patch` 후 SendUserFile (push가 막혀 있는 동안 작업을 잃지 않게)
