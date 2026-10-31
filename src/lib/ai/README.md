담당: 김태형. AI 호출·인터뷰·일정 생성·다시 짜기. 설계는 docs/roles/ai-engine.md 참고.

## 파일 목록

| 파일 | 내용 |
| --- | --- |
| `contracts/ai.ts` (계약 폴더) | 모든 AI API의 요청·응답 스키마. 프론트·백엔드가 같이 쓴다 |
| `client.ts` | AI 호출을 한 곳에 모은다(`callJson`). 공급자 순서·재시도·JSON 스키마 검사 |
| `deps.ts` | 다른 역할(`lib/trips`·`places`·`geo`·`auth`) 함수의 모양을 연결 지점(`AiDeps`)으로 선언 |
| `real-deps.ts` | `AiDeps`를 실제 함수로 채운다(`createRealDeps`·`getAiDeps`). **모든 AI 라우트는 `getAiDeps()`만 부른다** |
| `place-adapters.ts` | 이동주 쪽에 아직 없는 `searchCandidates`·`matchPlaceByName`을 `listPlaces`로 만들고, `searchPoi`는 항상 null. `getPlaceDetails`·`getLegs`를 안전하게 감싼다 |
| `http.ts` | route 공용 도우미 — `HttpError`(김경선 `src/lib/auth/http.ts`의 자식), `readJson`(zod 검사), `errorResponse`·`handle`(에러 응답 모양 통일) |
| `dev-deps.ts` | **테스트 전용** 메모리 가짜(`createDevDeps`, `x-dev-user` 가짜 로그인). 라우트·서버 코드는 import하지 않는다(`routes.test.ts`가 검사). production에서는 만들 수 없다 |
| `interview.ts` 이하 | 5~7단계(인터뷰·붙여넣기 정리·일정 생성·다시 짜기·설명) — 계획 `.superpowers/plan.md` 참고 |

테스트(`*.test.ts`)는 외부 API를 부르지 않고 가짜 `fetch`·가짜 연결 지점으로만 검사한다.
