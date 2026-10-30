담당: 김태형. AI 호출·인터뷰·일정 생성·다시 짜기. 설계는 docs/roles/ai-engine.md 참고.

## 파일 목록

| 파일 | 내용 |
| --- | --- |
| `contracts/ai.ts` (계약 폴더) | 모든 AI API의 요청·응답 스키마. 프론트·백엔드가 같이 쓴다 |
| `client.ts` | AI 호출을 한 곳에 모은다(`callJson`). 공급자 순서·재시도·JSON 스키마 검사 |
| `deps.ts` | 다른 역할(`lib/trips`·`places`·`geo`·`auth`) 함수의 모양을 연결 지점(`AiDeps`)으로 선언. 구현이 생기면 여기 모양 그대로 연결한다 |
| `http.ts` | route 공용 도우미 — `HttpError`, `readJson`(zod 검사), `errorResponse`·`handle`(에러 응답 모양 통일) |
| `dev-deps.ts` | 다른 역할 함수가 생길 때까지 쓰는 메모리 가짜(`createDevDeps`·`getAiDeps`). **dev-deps는 다른 역할 함수가 생기면 바꿔 끼운다** — 바꿔 끼우는 곳은 이 파일의 `getAiDeps`뿐이어야 한다 |
| `interview.ts` 이하 | 5~7단계(인터뷰·붙여넣기 정리·일정 생성·다시 짜기·설명) — 계획 `.superpowers/plan.md` 참고 |

테스트(`*.test.ts`)는 외부 API를 부르지 않고 가짜 `fetch`·가짜 연결 지점으로만 검사한다.
