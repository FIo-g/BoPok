# 역할: AI + 보행 계산 엔진 — 김태형 (P3, P4 엔진)

브랜치 접두어 `ai/` · 설계 문서 6장(AI), 7장(보행 계산 엔진), 2.3(실패 기준)

## 한 줄

걷는 시간과 판정을 계산하는 엔진(브라우저·서버 공용)과, 인터뷰·일정 생성·다시 짜기를 하는 AI를 만든다. **엔진을 먼저** 만든다 — 프론트와 김경선이 엔진을 기다린다.

## 맡는 폴더

`src/lib/engine`, `src/lib/ai`, `src/app/api/ai/**`

## 설계 가이드 — 엔진 (`src/lib/engine`)

순수 TypeScript. React·DB·fetch·환경 변수 import 금지. 같은 입력이면 같은 결과.

| 파일 | 내용 |
| --- | --- |
| `constants.ts` | 모든 숫자와 출처 주석: 나이·성별 속도표(Andrews 2023), 키 보정(Pua 2022, 10 cm당 0.07 m/s, 기준 키·상한), '천천히' 상한 0.85 m/s·보조기구 상한 0.73 m/s(한음 2020), 계단 가중치 2.0·경사 1.5(임시, 근거 없음 표시), 여유율 0.2, 걷기 조건 기본값 |
| `speed.ts` | `travelerSpeedMps(traveler)`, `groupProfile(travelers, tuned)` → 가장 느린 속도 + 가장 엄격한 조건 |
| `condition.ts` | 인터뷰 생활 예시 답 → 분 값 (시안 `Bopok/src/lib/plan-data.ts`·`judge.ts`의 `conditionFromAnswers` 이식) |
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

## 작업 순서

| 단계 | 할 일 | 완료 기준 |
| --- | --- | --- |
| 0 | contracts 중 Traveler·Condition·Stop·JudgeInput/Result·StopResult·LegResult 확정 | 네 명 승인 |
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
