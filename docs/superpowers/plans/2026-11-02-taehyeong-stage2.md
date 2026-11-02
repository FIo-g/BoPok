# 김태형 2단계 — 건강 정보·식단 주의, Claude 먼저, 운동 횟수 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 범위 확장 설계 6.2의 김태형 몫(② 건강 정보·식단 주의, ⑦ Claude 먼저, ⑧ 운동 횟수 질문)을 화면부터 DB까지 끝낸다.

**Architecture:** 건강 정보는 새 테이블·새 서버 폴더(`src/lib/health`)·새 API에 따로 두고, 서버가 보는 사람에 맞춰(`canSeeHealth`) 걸러 내려준다. 주의 계산은 엔진의 순수 함수(`dietCautions`)라 화면(브라우저)이 받은 건강 정보만으로 계산한다. **건강 정보는 AI에 보내지 않는다** — AI에는 서버가 계산한 "피할 음식 태그"만 간다. Claude는 `@anthropic-ai/sdk`로 공급자 목록 맨 앞에 붙인다.

**Tech Stack:** Next.js 16, TypeScript, zod 4, Drizzle + PGlite(테스트), vitest, `@anthropic-ai/sdk`(새 의존성)

**Spec:** `docs/superpowers/specs/2026-11-02-bopok-scope-expansion-design.md` 4.4(건강), 4.7(AI), 6장(2단계). MVP 설계 `2026-10-29-bopok-mvp-design.md` 2.3·6.4도 함께 읽는다.

## Global Constraints

- 브랜치 `ai/health-diet`. **작업 중 커밋은 마지막에 하나로 합친다**(사용자 지시: 커밋 최소화). 각 Task는 WIP 커밋을 해도 되지만 메시지는 한국어, 작성자 `KIM, TAEHYEONG <xogud0710@korea.ac.kr>`, Claude 관련 줄 없음. push하지 않는다.
- **건강 정보(병·약·보이는 범위)는 어떤 경우에도 AI 프롬프트·로그·에러 메시지에 넣지 않는다.** 서버 로그에는 tripId·travelerId·건수만.
- **주의는 띄우되 막지 않는다.** 화면 문구에 "의학적 조언이 아니에요. 의사·약사와 상의해 주세요"를 늘 보인다. 주의 규칙에 없는 조합을 "괜찮아요"라고 말하지 않는다 — 건강 정보가 있는데 주의가 없으면 "등록된 주의 정보 없음 (참고용)".
- **"본인만"이면 다른 가족에게 아무 표시도 없다**(건강 정보·주의 둘 다). 서버가 `canSeeHealth`로 거르고, 화면은 받은 것만으로 계산한다.
- **누가 고치나**: `canEditHealth`(Task 1). 계정 연결된 여행자는 본인만, 계정 없는 여행자는 처음 입력한 사람만(처음 입력은 그룹 구성원 누구나). 지우기 = 동의 철회 = 바로 삭제.
- 건강 테이블은 `trip_travelers`에 외래키·cascade를 걸지 않는다(여행자 저장이 지우고 다시 넣기라서). 여행(`trips`)이 지워지면 함께 지운다. 여행자가 목록에서 빠지면 그 사람 건강 정보를 지운다(Task 3).
- 공용 타입 변경은 optional만(`.default()` 금지, 설계 4장 머리말). `any` 금지, 한국어 "왜" 주석, 단위는 이름 끝.
- 새 의존성 `@anthropic-ai/sdk`는 PR 설명에 이유를 적는다(AGENTS 4장). 키 이름은 `.env.example`에 값 없이.
- Next.js 16 코드는 `node_modules/next/dist/docs/`를 확인하고 쓴다. route는 기존 `src/app/api/trips/[id]/travelers/route.ts` 모양(`handle`, `readJson`, `requireTripMember`)을 따른다.
- 화면: 큰 글씨, 가/가+, 상태는 색+글자(AGENTS 6장). 일정 화면은 `src/components/trip/slots/HealthSlot.tsx`만 고친다(설계 6.5) — 예외는 Task 6의 slot 입력 한 칸.
- 각 Task 끝에 해당 테스트 + `pnpm exec tsc --noEmit -p .`(PageProps 오류면 `pnpm exec next typegen` 먼저), 마지막 Task에서 `pnpm lint && pnpm test && pnpm build`.

## Review Focus

1. **"본인만" 정보가 다른 가족에게 새는 경로** — 목록 API, 주의 계산, 일정 화면, AI 프롬프트, 서버 로그. 다른 가족 세션으로 목록을 받으면 그 사람 항목이 아예 없어야 한다(Task 4 테스트).
2. **남이 고치기** — 계정 있는 엄마의 건강 정보를 아들이 PUT/DELETE하면 403(Task 4 테스트).
3. **동의 없는 저장** — `consent: true` 없으면 400(Task 4).
4. **근거 없는 규칙** — `DIET_RULES`의 모든 줄은 출처·확인 날짜·근거 문장이 있고 신뢰 등급 A/B만(Task 2 테스트).
5. **AI로 새는 건강 정보** — generate/revise 프롬프트 문자열에 병·약 이름이 없고 음식 태그 문장만 있다(Task 7 테스트).

---

### Task 1: 공용 타입 — 고칠 수 있는 사람, 운동 횟수

**Files:** Modify `src/lib/contracts/health.ts`, `src/lib/contracts/traveler.ts`, `src/lib/contracts/ai.ts`(INTERVIEW_SLOTS); Test `src/lib/contracts/health.test.ts`, `src/lib/contracts/contracts.test.ts`

**Interfaces — Produces:**
- `canEditHealth(existing: Pick<TravelerHealth, 'enteredByUserId'> | null, actorUserId: string, travelerUserId: string | null): boolean` — `travelerUserId`가 있으면 `actorUserId === travelerUserId`; 없고 `existing`이 있으면 `actorUserId === existing.enteredByUserId`; 둘 다 없으면 `true`(첫 입력)
- `ExerciseFrequencySchema = z.enum(['rarely', 'one_two', 'three_four', 'five_plus'])`, `type ExerciseFrequency`, `EXERCISE_FREQUENCY_LABEL: Record<ExerciseFrequency, string>` = 거의 안 해요 / 일주일에 1~2번 / 3~4번 / 5번 이상
- `TravelerSchema`에 `exerciseFrequency: ExerciseFrequencySchema.optional()` (주석: 근거를 찾기 전까지 판정 숫자에 쓰지 않고 AI 참고용, 설계 6.2)
- `INTERVIEW_SLOTS`에 `'traveler_exercise'`를 `'traveler_sex'` 바로 뒤에 추가
- 화면·주의에 쓰는 한국어 이름: `HEALTH_CONDITION_LABEL: Record<HealthCondition, string>`(당뇨·고혈압·고지혈증·신장 질환·통풍·심장 질환), `MEDICATION_CLASS_LABEL: Record<MedicationClass, string>`(와파린(항응고제)·일부 혈압약(칼슘채널차단제 계열) — Task 2b에서 바뀜) — health.ts, `FOOD_TAG_LABEL: Record<FoodTag, string>`(단 음식·짠 음식·기름진 음식·술·자몽·녹색 잎채소) — place.ts

- [ ] Step 1: 테스트 — `canEditHealth` 네 경우(계정 있음+본인 true, 계정 있음+대신 입력한 사람 false, 계정 없음+입력자 true·다른 사람 false, 첫 입력 true), `exerciseFrequency` 없는 기존 Traveler 통과·모르는 값 거부, 새 slot이 enum에 있음
- [ ] Step 2: 실패 확인 → Step 3: 구현 → Step 4: `pnpm exec vitest run src/lib/contracts` 통과

---

### Task 2: 엔진 — 식단 주의 계산과 주의 규칙 표

**Files:** Create `src/lib/engine/diet.ts`, `src/lib/engine/diet-rules.ts`, `src/lib/engine/diet.test.ts`, `src/lib/engine/diet-rules.test.ts`; Modify `src/lib/engine/index.ts`

**Interfaces — Consumes:** `TravelerHealth`, `DietRule`, `DietCaution`, `FoodTag`, `PlaceDetail.menus`(Task 1·1단계). **Produces:**
- `DIET_RULES: readonly DietRule[]` — 근거 조사 결과 `/tmp/claude-0/-home-user-BoPok/5200f460-bfd2-57be-8d37-0db1f20c063f/scratchpad/diet-rules.json`(신뢰 A/B만)을 옮긴다. 파일이 없거나 비면 빈 배열 + 주석 "근거 확인 전"
- `dietCautions(input: { health: TravelerHealth[]; stops: Stop[]; places: Record<string, PlaceDetail>; rules: readonly DietRule[] }): DietCaution[]` — 장소(placeId 있는 것) 메뉴의 음식 태그 × 여행자 건강 정보의 병·약 × 규칙이 맞으면 한 줄. 정렬: stops 순서 → 메뉴 순서 → travelerId. 같은 (stopKey, menuName, foodTag, travelerId, reason) 중복 없음. `reason`은 병·약의 한국어 이름(Task 1의 `HEALTH_CONDITION_LABEL`/`MEDICATION_CLASS_LABEL`)
- `avoidFoodTags(health: TravelerHealth[], rules: readonly DietRule[]): FoodTag[]` — 일행 전체의 병·약에 걸리는 음식 태그, 정렬·중복 없음 (AI 프롬프트용, 이유 없음)
- 엔진은 순수 TS(AGENTS 4장) — `src/lib/engine/purity.test.ts`가 지킨다

- [ ] Step 1: 테스트 — 당뇨+단 음식 메뉴 → 주의 1줄(출처·확인 날짜 그대로), 해당 없는 병 → 0줄, 메뉴 없는 장소·placeId null → 0줄, 두 사람 같은 메뉴 → 사람마다 1줄, 같은 메뉴 태그 중복 → 1줄, `avoidFoodTags` 정렬·중복 제거, 빈 건강 정보 → `[]`. `diet-rules.test.ts`: 모든 규칙이 `DietRuleSchema` 통과·`confidence`가 A/B·`sentence`/`source`/`checkedAt` 비어 있지 않음·id 중복 없음
- [ ] Step 2: 실패 확인 → Step 3: 구현 → Step 4: `pnpm exec vitest run src/lib/engine` 통과

---

### Task 3: DB와 서버 함수 — 건강 정보 저장, 운동 횟수 칸

**Files:** Create `src/lib/db/schema/health.ts`, `src/lib/health/index.ts`, `src/lib/health/health.ts`, `src/lib/health/health.test.ts`; Modify `src/lib/db/schema/index.ts`, `src/lib/db/schema/trips.ts`(trip_travelers에 `exercise_frequency` text nullable), `src/lib/trips/travelers.ts`(칸 매핑 + 빠진 여행자 건강 정보 지우기 한 줄); Generate `drizzle/0003_*.sql`(`pnpm db:generate`, 이름은 drizzle이 정함)

**Interfaces — Produces** (`src/lib/health`, 맨 위 `import 'server-only'`):
- 테이블 `trip_traveler_health`: `trip_id`(→ trips.id, on delete cascade), `traveler_id`, `conditions text[]`, `medication_classes text[]`, `visibility`('group'|'self'), `consent_at timestamptz`, `entered_by_user_id`(→ user.id, on delete cascade), 기본키 `(trip_id, traveler_id)`
- `listVisibleHealth(tripId: string, viewerUserId: string, db?): Promise<TravelerHealth[]>` — 현재 여행자 목록(`listTravelers`)에 있는 사람만, `canSeeHealth(h, viewer, traveler.userId ?? null)`가 true인 것만
- `putHealth(args: { tripId; travelerId; actorUserId; input: TravelerHealthInput }, db?): Promise<TravelerHealth>` — 여행자가 없으면 `HttpError(404)`, `canEditHealth` false면 403, `consentAt`은 서버 시각(`toISOString()`), `enteredByUserId`는 첫 입력자를 유지
- `deleteHealth(args: { tripId; travelerId; actorUserId }, db?): Promise<void>` — 같은 권한 검사, 없으면 그냥 끝
- `avoidFoodTagsForTrip(tripId: string, db?): Promise<FoodTag[]>` — 보이는 범위와 상관없이 일행 전체(`avoidFoodTags(all, DIET_RULES)`) — AI에 이유가 가지 않으므로
- `deleteHealthExcept(tripId: string, keepTravelerIds: string[], db?): Promise<void>` — `replaceTravelers`가 저장 뒤 부른다
- HttpError는 `src/lib/auth/http.ts`의 것을 쓴다. `db.transaction()` 금지(AGENTS 8장)
- 마이그레이션은 만들기만 하고 적용(`db:migrate`)하지 않는다(main 머지 후)

- [ ] Step 1: PGlite 테스트(기존 `src/lib/trips/*.test.ts`의 DB 준비 방식을 따른다) — 저장·읽기, 가족 모두/본인만 걸러짐(계정 있는 여행자, 계정 없는 여행자), 고치기 권한 403, 여행자 없음 404, 첫 입력자 유지, 지우기, 여행자 목록에서 빠지면 지워짐, `exerciseFrequency` 저장·읽기
- [ ] Step 2: 실패 확인 → Step 3: 구현 + `pnpm db:generate` → Step 4: `pnpm exec vitest run src/lib/health src/lib/trips src/lib/db` 통과

---

### Task 4: API와 api-client

**Files:** Create `src/app/api/trips/[id]/health/route.ts`(GET), `src/app/api/trips/[id]/travelers/[tid]/health/route.ts`(PUT, DELETE), `src/app/api/trips/health.test.ts`; Modify `src/lib/api-client/types.ts`, `real.ts`, `lazy-mock.ts`, `src/mocks/mock-api.ts`(+ 테스트)

**Interfaces — Produces:**
- `GET /api/trips/:id/health` → `{ health: TravelerHealth[] }`(보는 사람 기준). 응답 스키마 `HealthListResponseSchema`를 `src/lib/contracts/health.ts`에 둔다
- `PUT /api/trips/:id/travelers/:tid/health` 본문 `TravelerHealthInput` → `TravelerHealth`; `DELETE` → 204
- `api.health.list(tripId)`, `api.health.put(tripId, travelerId, input)`, `api.health.remove(tripId, travelerId)` — 목업도 서버와 같은 규칙(`canSeeHealth`, `canEditHealth`, consent)

- [ ] Step 1: route 테스트(기존 `src/app/api/trips/travelers.test.ts` 방식) — 로그인 없음 401, 다른 그룹 403, consent 없음 400, 남의 계정 여행자 PUT/DELETE 403, 본인만 항목이 다른 가족 GET에 없음, 정상 저장·삭제. 목업 테스트 같은 경우
- [ ] Step 2: 실패 확인 → Step 3: 구현 → Step 4: `pnpm exec vitest run src/app/api src/lib/api-client src/mocks` 통과

---

### Task 5: 화면 — "함께 가는 사람"에 건강 정보와 운동 횟수

**Files:** Create `src/components/trip/HealthEditor.tsx`; Modify `src/components/screens/TravelersScreen.tsx`(여행자마다 편집기 자리 + 운동 횟수 칩); Test: 순수 도우미가 생기면 `src/lib/plan/health-form.ts` + 테스트

**Interfaces — Consumes:** `api.health.*`(Task 4), `canEditHealth`, `EXERCISE_FREQUENCY_LABEL`(Task 1)
- 여행자 카드마다 "건강 정보 (선택)" 접힌 칸: 병 칩(한국어 이름), 약 종류 칩, 보이는 범위(가족 모두 / 본인만, 기본 **본인만**), 동의 체크("병·약 정보는 민감한 정보예요. 이 여행의 식단 주의를 보여 주고, AI가 식당을 고를 때 ‘피할 음식’(예: 짠 음식)만 알려 주는 데 써요. 병·약 이름과 누구인지는 AI에 보내지 않아요. 계정 연결이 바뀌면 지워져요" — 최종 리뷰에서 실제 쓰임에 맞게 고침), 저장, 지우기(동의 철회). 고칠 수 없는 사람에게는 "이 분이 직접 입력해요"만 보이고 내용은 서버가 준 만큼만
- 운동 횟수 칩 4개(선택 안 함 가능)는 기존 여행자 저장(`putTravelers`)으로 함께 저장
- 늘 보이는 문구: "의학적 조언이 아니에요. 의사·약사와 상의해 주세요"

- [ ] Step 1: 순수 도우미 테스트(폼 상태 → `TravelerHealthInput`, 저장 버튼 활성 조건: 동의 체크 필수) → Step 2: 실패 확인 → Step 3: 구현 → Step 4: `pnpm exec tsc --noEmit -p .`, `pnpm lint`

---

### Task 6: 일정 화면 — HealthSlot

**Files:** Modify `src/components/trip/slots/HealthSlot.tsx`, `src/components/trip/slots/types.ts`(`places: Record<string, PlaceDetail>` 한 칸 추가 — 비용 slot도 쓴다), `src/components/screens/TripScreen.tsx`(slotProps에 `places: judged?.places ?? {}` 한 줄)

- `HealthSlot`: `api.health.list(tripId)`로 받은 것 + `props.places` + `props.stops` → `dietCautions(..., DIET_RULES)`. 받은 건강 정보가 없으면 아무것도 그리지 않는다(본인만인 가족 화면도 그렇다). 있으면 카드: 장소·메뉴·음식 태그·누구(이름표)·이유·근거 문장·출처·확인 날짜, 없으면 "등록된 주의 정보 없음 (참고용)". 문구 "의학적 조언이 아니에요…" 늘. 주의는 막지 않는다(버튼 없음)
- [ ] Step 1: 화면 조각이 쓰는 순수 함수(주의 → 화면 줄)를 `src/lib/plan/health-view.ts`에 두고 테스트 → Step 2~4 같은 방식

---

### Task 7: AI — 피할 음식 태그, 공용 문장 검사, 운동 횟수 질문

**Files:** Modify `src/lib/ai/deps.ts`(`getAvoidFoodTags(tripId): Promise<FoodTag[]>`), `real-deps.ts`(→ `avoidFoodTagsForTrip`), `dev-deps.ts`(메모리 가짜), `generate.ts`, `revise.ts`, `explain.ts`, `text-guard.ts`, `interview.ts`; Tests 각 `*.test.ts`

- 프롬프트: 태그가 있으면 한 줄 `피할 음식: 단 음식, 짠 음식 — 이런 메뉴가 많은 식당은 고르지 마라.`(태그 → 한국어 이름). 병·약 이름은 절대 넣지 않는다
- `hasHealthClaim(s: string): boolean`(text-guard) — 당뇨·혈당·혈압·고지혈·콜레스테롤·신장·콩팥·통풍·요산·심장·항응고·와파린·자몽·저염·싱겁게·복용·지병·질환. AI 메모(generate/revise note)와 바뀐 점 한 줄(explain)에 걸리면 기존 숫자 검사처럼 버리거나 고정 문장
- 운동 횟수: 인터뷰 `traveler_exercise` slot(여행자마다, 선택지 4개 + '잘 모르겠어요'는 비움), 채운 값은 여행자 저장으로. generate/revise 프롬프트에 "운동을 거의 안 하는 분이 함께 간다"처럼 참고 한 줄(숫자 없음, 판정 숫자에는 안 씀)
- [ ] Step 1: 테스트 — 프롬프트에 태그 문장이 있고 병·약 이름이 없음(fake callJson이 받은 메시지 검사), 메모에 "당뇨" 있으면 저장 안 됨, explain 고정 문장, 인터뷰 운동 slot 진행 → Step 2~4

---

### Task 8: Claude 먼저 (⑦)

**Files:** Modify `src/lib/ai/client.ts`, `src/lib/ai/client.test.ts`, `.env.example`, `package.json`(`@anthropic-ai/sdk`)

- `providersFromEnv`: `ANTHROPIC_API_KEY`가 있으면 맨 앞에 `{ name: 'claude', model: env.ANTHROPIC_MODEL || 'claude-opus-5-5' }`, 그다음 Upstage → opencode
- 호출은 **공식 SDK** `new Anthropic({ apiKey, maxRetries: 0, timeout: 남은 ms })` → `client.beta.messages.create({ model, max_tokens: 16000, system, messages, output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })`. 응답은 `stop_reason === 'refusal'`이면 공급자 실패로 다음 공급자, 아니면 `text` 블록을 이어 붙여 기존 JSON 파싱·zod 검사·1회 재시도 흐름에 넣는다. 공급자 실패 분류(429·529·5xx·네트워크 → 다음 공급자)는 SDK의 타입 에러 클래스로(`Anthropic.RateLimitError` 등) — 문자열 비교 금지
- `temperature`를 Claude 요청에 보내지 않는다(현재 모델에서 400). 구조화 출력(`output_config.format`)은 이번에는 쓰지 않고 기존 "JSON만 답하라" + zod 검사를 그대로 쓴다(스키마 변환 위험을 줄임 — Ruling)
- 테스트: 가짜 SDK 클라이언트 주입(실제 호출 금지, AGENTS 5장) — 키 있으면 Claude가 첫째, 429면 다음 공급자, refusal이면 다음 공급자, 텍스트 JSON 파싱
- `.env.example`: `ANTHROPIC_API_KEY=`, `ANTHROPIC_MODEL=` (주석: 비우면 claude-opus-5-5)

---

### Task 9: 마무리

- [ ] `pnpm lint && pnpm test && pnpm build` 모두 통과
- [ ] 설계 4.4·4.7·6.2, `docs/roles/ai-engine.md` 2단계 할 일에 끝난 것 표시, 남은 것(폭염 주의, 엔진 근거 값) 사유와 함께
- [ ] 콜드 스타트 측정: `curl -s -o /dev/null -w '%{time_total} %{http_code}' https://bopok.vercel.app/` 등 3회, 응답 헤더 `x-vercel-id`의 지역 — 막히면 막혔다고 기록
- [ ] WIP 커밋을 하나로 합친 뒤(작성자 김태형) 패치를 만들어 보낸다
