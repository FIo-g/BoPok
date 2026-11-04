# 역할: AI + 보행 계산 엔진 — 김태형 (P3, P4 엔진)

브랜치 접두어 `ai/` · 설계 문서 6장(AI), 7장(보행 계산 엔진), 2.3(실패 기준)

## 한 줄

걷는 시간과 판정을 계산하는 엔진(브라우저·서버 공용)과, 인터뷰·일정 생성·다시 짜기를 하는 AI를 만든다. **엔진을 먼저** 만든다 — 프론트와 김경선이 엔진을 기다린다.

## 2단계 할 일 (11/2~) — 김태형

기능 하나를 끝까지 맡는다 (AGENTS 3장, 설계 `docs/superpowers/specs/2026-11-02-bopok-scope-expansion-design.md` 6장).

1. ✅ (11/2 main) **일정 화면 뼈대 — 가장 먼저** (설계 6.5): 날짜 탭, 고른 날 기준 판정·지도·목록·빠른 수정안, 직접 고치기 순서 번호 바꾸기, 빠른 수정안은 그날만 바꿔 끼우기, 기능별 빈 자리 `src/components/trip/slots/` 4개. 리뷰어 오하연
2. ✅ (11/3 main) **② 건강 정보·식단 주의** (설계 4.4 "만든 것"): 주의 규칙 표 조사(질병관리청·식약처 근거 구절), 엔진 `dietCautions`, 건강 정보 저장 API·DB(키는 tripId+travelerId, cascade 금지), 동의 화면, `HealthSlot`, AI 일정 짜기에 반영, 공용 문장에 병·약·식단 이유 금지(`text-guard`). 리뷰어 김경선(API·DB), 오하연(화면)
3. ✅ (11/3 main, 콜드 스타트 11/4 한국에서 잼: 첫 화면 0.06~0.12초, API 첫 호출 2.0초 → 이후 0.15~0.28초, Vercel Production에 `ANTHROPIC_API_KEY`·`TOURAPI_SERVICE_KEY` 넣음 11/3, 모델은 Sonnet medium 11/4) **⑦ Claude 먼저** (설계 4.7): 공급자 순서 Claude → Upstage → opencode, `.env.example`에 키 이름. **콜드 스타트 측정**: 배포 응답 헤더 `x-vercel-id`가 sin1인지, 첫 로그인 시간
4. **⑧ 피로도·체력** (설계 6.2): ✅ 인터뷰에 "일주일에 운동 몇 번"(근거 찾기 전까지 판정 숫자에 안 씀) · ✅ (11/3 main) 계단·경사·키 보정을 논문 값으로(근거 노트 `docs/superpowers/specs/evidence/2026-11-03-engine-evidence.md`, 75세 이상 쉬지 않고 걷기 기본값 15분·85세 이상·보조기구 10분 — 11/3 결정) · ✅ (11/3) 폭염 주의 → 날씨 전체로 넓힘(설계 4.8: 기상청 단기·중기예보, 폭염은 경고·비·눈·추위·바람은 여행 준비, 판정은 그대로, AI는 실내 위주 참고 줄. 근거 노트 `docs/superpowers/specs/evidence/2026-11-03-weather.md`) · ✅ (11/3) 한파도 경고, 기상청 기상특보(발효·예비특보), 확정 화면에도 날씨 카드
5. ✅ (11/3) **여러 날 일정 처음 짜기**(인터뷰 기간으로 날마다 3~5곳, 앞 7일까지)와 **새 안 바로 고르기**(slot의 `onNewVersion`, 대화 → AI 뒤 새로 고침 없이)
6. ✅ (11/4) **일정에서 바뀐 곳 표시**: AI가 일정을 바꿨는데 걷는 구간이 같으면 "바뀐 점 없음"만 보이던 것 → 엔진 `diffStops`/`formatStopDiff`로 그날의 새로 넣은 곳·뺀 곳·시각 바뀐 곳을 "일정에서 바뀐 곳" 줄로 보인다(시각은 저장된 값 그대로, 걷기 숫자 줄과 구분)
7. ✅ (11/4) **한밭수목원 동원 코스 장소 안 데이터**(⑤ 데모 버그 — 하연 님 일을 대신 시작): 지점 11·구간 13, OSM 보행로 최단 경로 + 공식 종합안내도 대조, 계단은 OSM `steps`가 지나는 구간만 "있음"(우회로 함께), 나머지는 "기록 없음". 공유 DB에는 `scripts/data/load-place-inside.mjs --apply`로 빈 장소에만 채운다

## 맡는 폴더

`src/lib/engine`, `src/lib/ai`, `src/app/api/ai/**`, `src/lib/weather`, `src/app/api/trips/[id]/weather`

## 설계 가이드 — 엔진 (`src/lib/engine`)

순수 TypeScript. React·DB·fetch·환경 변수 import 금지. 같은 입력이면 같은 결과.

| 파일 | 내용 |
| --- | --- |
| `constants.ts` | 모든 숫자와 출처 주석: 나이·성별 속도표(Andrews 2023), 키 보정(Pua 2022, 10 cm당 0.07 m/s, 기준 키·상한), '천천히' 상한 0.85 m/s·보조기구 상한 0.73 m/s(한음 2020), 계단 가중치 2.0·경사 1.5(임시, 근거 없음 표시), 여유율 0.2, 걷기 조건 기본값 |
| `speed.ts` | `travelerSpeedMps(traveler)`, `groupProfile(travelers, tuned)` → 가장 느린 속도 + 일행 조건(부모님 답 80% 비중, 자녀 답은 더 엄격하게 만들 때만 — 설계 7.1.1) + 칸별 출처 + 부모님 확인이 필요한 칸(설계 7.1.3) |
| `condition.ts` | 인터뷰 생활 예시 질문·선택지와 답 → 분 값 (시안 `Bopok/src/lib/plan-data.ts`·`judge.ts`의 `conditionFromAnswers` 이식, 설계 7.1.2). '잘 모르겠어요'는 칸을 비워 둔다 |
| `route.ts` | 하루 걷는 길 만들기: 장소별 출발 지점(이동수단에 맞는 주차장·정류장) → 입구 → 볼거리 → 출구, 다음이 탈것이면 출발 지점으로 돌아가는 구간 포함(같은 구간 역방향), 빼기·우회로 반영, 장소 사이 경로 끼우기 |
| `required-legs.ts` | `requiredLegs(stops, places): LegRequest[]` — 판정에 필요한 장소 사이 경로 목록 (프론트·김경선이 이걸로 `/api/legs`·`getLegs`를 부름) |
| `judge.ts` | `judge(input: JudgeInput): JudgeResult` — 설계 7.3 그대로: 연속 걷기는 쉼터·탈것·`seated` 장소에서만 끊김(관람 장소 사이 걷기는 이어짐), 범위 최댓값으로 비교, 계단 3상태(`unknown`은 위반 아님, `unrecordedStairs`에 모음), 부분 판정, 판정 이유 한 문장(노션 4-2 규칙) |
| `quick-fix.ts` | `quickFixes(input)` → A(우회로·선택 구간 빼기) / B(A + 가장 긴 묶음의 쉼터에서 쉬기) / C(B + 걷는 장소 사이를 택시로). 위반이 사라진 첫 단계까지, 앞 단계는 "이것만으로는 부족" 표시. 시안 `applyOption` 확장 |
| `diff.ts` | `diffSummary(prev, next)` → "가장 긴 연속 걷기 27~30분 → 18~20분" 같은 비교 숫자 (문장은 AI나 고정 문장) |

테스트: 시안 `Bopok/src/lib/judge.test.ts`를 옮기고, 노션 4-2 계산 예시(연속 28분 → A 부족 → B 해결)를 그대로 테스트로 만든다. 속도 모델은 표의 경계값(69세/70세, 키 보정 상한, 보조기구)을 테스트한다.

## 설계 가이드 — AI (`src/lib/ai`, `src/app/api/ai/**`)

| 파일·API | 내용 |
| --- | --- |
| `client.ts` | 공급자 교체 가능한 호출 함수. Upstage Solar Pro 먼저, 실패·한도 초과면 opencode. 출력 JSON → zod 검사 → 실패 시 1회 재시도. 키는 서버 환경 변수 |
| `interview.ts` + `POST /api/ai/interview` | **칸 채우기 대화** (설계 6.3의 칸 표). 요청 `{ tripId, answer? }` → 응답 `{ text, choices, slot, done, filled }`. 칸 순서는 코드가 정하고, AI는 질문을 자연스럽게 말하기·자유 입력을 칸 값으로 바꾸기·필요할 때 덧붙여 묻기만 한다. 대화와 채운 칸은 `trip_interviews`에 저장(스키마는 김경선 `trips.ts`, 컬럼은 함께 정함). 칸이 채워지면 여행자 정보는 김경선 API/함수로 저장 |
| `parse-schedule.ts` + `POST /api/ai/parse-schedule` | 붙여넣은 일정 → stops. 장소 이름을 장소 DB(`src/lib/places`의 검색, 이동주)와 맞추고, 못 맞추면 TMAP POI 검색(이동주 `lib/geo`)으로 좌표만 찾아 `placeId: null` |
| `generate.ts` + `POST /api/ai/generate` | 처음부터 일정. 서버가 `searchCandidates({ styles, budget, transport, avoidStairs })`(이동주)로 후보를 추려 넘기고, AI는 placeId로만 답한다(목록 밖 id는 버림). 결과를 `engine.judge`로 판정 → 조정 필요면 위반 내용을 붙여 1회 다시 요청 → `createVersion(..., madeBy: 'ai')`(김경선) |
| `revise.ts` + `POST /api/ai/revise` | 의견 반영해서 다시 짜기. `getTripContext`, `getOpinions`(김경선)로 현재 버전·의견·여행자 조건을 받아 새 stops 생성 → 판정 → 1회 재시도 → `createVersion(..., appliedOpinionIds)`. 꼭 갈 곳·예약은 빼거나 바꾸지 않는다 |
| `explain.ts` | 버전·수정안 카드의 바뀐 점 한 줄. 입력은 `engine.diffSummary` 숫자뿐. 실패하면 고정 문장("계단 구간 1곳을 우회로로 변경") |

AI 실패 시: 붙여넣기는 "장소를 직접 골라 주세요"로, 처음부터는 "다시 시도" + 직접 고르기로 넘어가게 에러 코드를 contracts에 정한다.

## 받는 것 / 주는 것

- 받는 것: `PlaceDetail`·`searchCandidates`·POI 검색(이동주), `createVersion`·`getTripContext`·`getOpinions`(김경선)
- 주는 것: `src/lib/engine` 전체(오하연·김경선), `/api/ai/*`(오하연)
- 장소 DB가 아직 없으면 `src/mocks`의 장소 2~3곳으로 엔진·AI를 개발한다

### AI가 부르는 다른 역할 함수의 모양 **[김태형 10/30, 10/31 실제 연결로 교체]**

`src/lib/ai/deps.ts`가 AI가 부르는 함수의 모양(`AiDeps`)을 정하고, `src/lib/ai/real-deps.ts`의 `getAiDeps()`가 실제 함수로 채운다. 모든 AI 라우트는 이것만 쓴다. `src/lib/ai/dev-deps.ts`의 메모리 가짜(`x-dev-user` 가짜 로그인)는 **테스트에서만** 쓰고 실제 실행(개발 서버·배포)에는 들어가지 않는다 — `src/lib/ai/routes.test.ts`가 지킨다. 이름이나 인자가 바뀌면 `real-deps.ts`에서 맞춘다.

- 김경선 (`src/lib/trips`, `src/lib/auth`) — 모두 연결됨
  - `requireTripMember(request, tripId)` → 로그인 안 했으면 401, 그 여행 그룹의 구성원이 아니면 403(없는 여행도 403). 던지는 `HttpError`는 `src/lib/auth/http.ts`의 것이고, AI의 `HttpError`가 그 자식이라 AI의 `handle`이 401/403/404를 그대로 응답 코드로 바꾼다
  - `createVersion(tripId, { parentId, stops, madeBy: 'ai', madeByUserId?, note?, appliedOpinionIds? })` → `TripVersion`
  - `getTripContext(tripId)` → `{ trip: { id, groupId, startMode: 'paste'|'scratch' }, travelers: Traveler[], versions: TripVersion[] }` (`versions`에 `stops` 포함)
  - `getOpinions(versionId)` → `Opinion[]`
  - `saveTravelers(tripId, travelers: Traveler[])` — 인터뷰가 끝나면 부른다
  - `interviews.get/save` — `InterviewState`를 `trip_interviews`의 jsonb 한 칸에 저장한다
  - 알려진 한계: 저장된 버전의 `summary`(판정 요약)는 아직 null이다. AI API 응답의 `summary`는 엔진 결과로 따로 돌려준다
- 이동주 (`src/lib/places`, `src/lib/geo`)
  - `getPlaceDetails(ids)` → `PlaceDetail[]` — 연결됨. 형식이 틀린 id는 빼고 묻는다
  - `getLegs(requests)` → `Leg[]` — `getLegsPartial`을 20개씩 나눠 부른다. 걷는 구간(walk)만 묻고, 받지 못한 경로는 빼서 엔진이 '정보 부족'으로 판정한다
  - `searchCandidates({ styles, budget?, transport, avoidStairs, limit, query?, kind? })`, `matchPlaceByName(name)`, `searchPoi(name)` — **11/3 이동주 실제 함수로 연결**(PR #29, `src/lib/places/search.ts`·`src/lib/geo/poi.ts`). 후보는 SQL로 종류·계단을 보고, 스타일 점수 → 걷는 길 기록이 있는 장소 → 이름 순서다. 장소 DB에 식당·카페가 2만 곳이라 이름 맞추기의 "입력 안에 이름이 통째로 들어 있음"은 **세 글자 이상** 이름만 본다(두 글자 식당 "시장"이 "한밭 전통시장"에 맞지 않게)
  - **AI 일정 짜기·다시 짜기 후보는 관광지만**(`kind: 'attraction'`) **[결정: 김태형 11/4]**: 가져온 식당·카페에는 위치 기준 순위가 아직 없어 대전 어디든 이름순으로 뽑히기 때문이다. 식사는 전처럼 식사 자리(placeId null)로 두고, 사람이 고른 식당·꼭 갈 곳은 그대로 쓴다(다시 짜기는 지금 버전의 장소를 모두 후보에 더한다). 방문지 근처 식당은 11/4 이동주 #35가 AI가 만든 빈 식사·카페·숙박 자리를 동선 근처 등록 장소로 채우는 방식으로 붙였다(`route-services.ts`)
  - 붙여넣기 정리는 장소마다 이름 맞추기·POI 검색을 동시에 부른다(TMAP POI 8초 제한이 차례로 쌓여 60초를 넘지 않게)

## 작업 순서

| 단계 | 할 일 | 완료 기준 |
| --- | --- | --- |
| 0 | contracts 중 `traveler.ts`·`judge.ts` 확인 (초안은 main에 있음) | 고칠 점이 있으면 PR, 팀원 한 명 승인 |
| 1 | 엔진: constants·speed·condition + 테스트 | 속도 표 경계값 테스트 통과 |
| 2 | 엔진: route·required-legs·judge + 테스트 (시안·노션 예시) | 노션 4-2 예시가 테스트로 재현 |
| 3 | 엔진: quick-fix·diff + 테스트 | A 부족 → B 해결 테스트 |
| 4 | AI client (Upstage → opencode), 스키마 검사·재시도 | 실제 키로 간단한 JSON 응답 확인 (테스트는 가짜 공급자) |
| 5 | 인터뷰 API | 목업 여행으로 칸이 끝까지 채워짐 |
| 6 | 붙여넣기 정리, 처음부터 일정 생성 (판정 후 1회 재시도) | 버전이 저장되고 판정 요약이 붙음 |
| 7 | 의견 반영 다시 짜기, 바뀐 점 한 줄 | 의견이 반영된 새 버전, "반영됨" 표시 |

## 주의

- **AI가 걷는 시간·계단·판정 숫자를 만들지 않게 한다.** 프롬프트에 숫자를 쓰라고 하지 말고, 문장에 들어갈 숫자는 엔진 결과를 넘겨서 그대로 쓰게 한다.
- 작업량이 가장 많은 역할이다. 버거우면 `quick-fix.ts`를 김경선에게 넘기는 것을 팀에 제안한다.
