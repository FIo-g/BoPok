# 보폭 — 팀 공동 작업 규칙

Claude Code, Codex 등 AI 도구로 작업할 때 모두 이 규칙을 따른다. 사람도 마찬가지다.
(Claude Code는 `CLAUDE.md`를 통해 이 파일을 읽는다.)

## 0. 세션 시작 순서 (AI 도구는 반드시 지킨다)

1. **사용자가 누구인지 먼저 묻는다.** 이번 세션에서 사용자가 아직 자기 이름을 말하지 않았다면, 다른 작업을 하기 전에 이렇게 묻는다:
   > 누구신가요? (오하연 / 김경선 / 김태형 / 이동주)
2. 답에 맞는 **역할 문서**를 처음부터 끝까지 읽는다.

   | 사람 | 역할 | 역할 문서 | 브랜치 접두어 | GitHub |
   | --- | --- | --- | --- | --- |
   | 오하연 | 프론트엔드 전부 | `docs/roles/frontend.md` | `fe/` | `aress7578-lgtm` |
   | 김경선 | 계정·그룹 + 여행·버전·의견 (P1, P2) | `docs/roles/account-trip.md` | `acct/` | (추가 예정) |
   | 김태형 | AI + 보행 계산 엔진 (P3, P4 엔진), 레포 관리자 | `docs/roles/ai-engine.md` | `ai/` | `FIo-g` |
   | 이동주 | 장소 데이터 + 장소 사이 경로 (P5, P4 경로) | `docs/roles/data-geo.md` | `geo/` | (추가 예정) |

   PR 리뷰어를 지정할 때 이 GitHub 아이디를 쓴다.

3. 공통 문서 `docs/roles/common.md`(0단계 준비, 공용 타입 초안)와 설계 문서 `docs/superpowers/specs/2026-10-29-bopok-mvp-design.md`에서 역할 문서가 가리키는 장을 읽는다.
4. `git status`와 현재 브랜치를 확인한다. `main`이면 최신으로 받은 뒤(`git pull`) **그 사람의 접두어로 작업 브랜치를 만든다** (8장).
5. 역할 문서의 "작업 순서"에서 아직 안 끝난 다음 단계를 찾아 사용자에게 알려 주고, **무엇을 어떻게 할지 짧게 계획을 보여 준 뒤 확인을 받고** 시작한다.
6. 이 세션 동안은 그 사람의 역할로 일한다. 다른 역할의 폴더를 고쳐야 하면 먼저 사용자에게 알린다(3장).

## 1. 기준 문서

- **설계 문서가 기준이다.** 설계와 다르게 만들어야 할 것 같으면 코드로 먼저 바꾸지 말고 사용자에게 묻는다. 정해진 내용은 설계 문서나 역할 문서에 반영한다(채팅에만 남기지 않는다).
- 답변·주석·PR 설명·커밋 메시지는 한국어로 쓴다.

**프로젝트 한 줄**: 부모님과의 대전 여행 일정을 가족이 함께 짜는 웹 서비스(MVP). 관광지별 계단·쉼터·도보 시간을 보여주고, 부모님 걷기 조건으로 판정하고, AI 인터뷰로 일정을 만들거나 다시 짠다.

## 2. 스택과 명령어

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, pnpm, vitest
- DB: Neon(PostgreSQL) + Drizzle ORM / 로그인: Better Auth
- 지도: MapLibre GL + OpenFreeMap (+ three.js) / AI: Upstage Solar Pro(→ opencode 대체) / 경로: TMAP
- **이 Next.js 버전은 이전과 API가 다를 수 있다. Next.js 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 가이드를 확인하고, 사용 중단(deprecation) 안내를 따른다.**

```bash
pnpm install
pnpm dev          # 개발 서버
pnpm test         # vitest
pnpm lint
pnpm build        # 타입 검사 포함
```

PR을 올리기 전에 `pnpm lint && pnpm test && pnpm build`가 모두 통과해야 한다.

## 3. 담당 폴더

| 폴더 | 담당 |
| --- | --- |
| `src/app/**/page.tsx`, `layout.tsx`, `src/components/**`, `src/lib/api-client`, `src/mocks`, `public/**`, `scripts/map` | 오하연 |
| `src/app/api/{auth,groups,invites,trips,versions,opinions}/**`, `src/lib/auth`, `src/lib/trips`, `src/lib/db/client.ts`, `src/lib/db/schema/{auth,groups,trips}.ts` | 김경선 |
| `src/app/api/ai/**`, `src/lib/ai`, `src/lib/engine` | 김태형 |
| `src/app/api/{places,legs}/**`, `src/lib/places`, `src/lib/geo`, `src/lib/db/schema/places.ts`, `scripts/data`, `data/` | 이동주 |
| `src/lib/contracts` | **모두** — 바꾸면 PR에 프론트와 관련 백엔드 담당을 리뷰어로 넣어 알린다 |

- **내 담당이 아닌 폴더는 고치지 않는다.** 꼭 필요하면 그 담당에게 말하고, PR 리뷰어로 그 사람을 넣는다.
- 다른 역할의 기능이 아직 없으면 기다리지 말고 `src/lib/contracts`의 타입대로 가짜 구현(목업)으로 진행한다.

## 4. 코드 규칙

- **경계는 `src/lib/contracts`.** API 요청·응답과 공용 타입은 여기에 zod 스키마 + 타입으로 먼저 정하고, 서버는 받은 값을 반드시 스키마로 검사한다.
- **프론트 ↔ 백엔드는 `src/app/api/**/route.ts`로 만난다.** Server Action은 한 화면 안에서만 쓰는 폼 제출 정도로 한정한다.
- **백엔드 파트끼리는 `src/lib/**`의 서버 함수로 만난다.** 예: AI가 새 버전을 저장할 때 `src/lib/trips`의 함수를 부른다(다른 파트의 DB 테이블을 직접 쓰지 않는다).
- **`src/lib/engine`은 순수 TypeScript.** React, DB, fetch, 환경 변수를 import하지 않는다(브라우저에서도 돌아간다). 같은 입력이면 항상 같은 결과.
- **서버 전용 코드**(`lib/db`, `lib/auth`, `lib/trips`, `lib/places`, `lib/ai`, `lib/geo`)는 파일 맨 위에 `import 'server-only'`.
- **지도 라이브러리(maplibre-gl, three)는 `src/components/map/`에서만 import한다.** 나머지는 GeoJSON·핀 목록 같은 값만 넘긴다(지도 교체 대비).
- **AI 호출은 `src/lib/ai`에서만.** 출력은 JSON 스키마로 검사하고, 실패하면 한 번 재시도, 그래도 실패하면 정해진 대체 동작.
- 단위는 이름 끝에 붙인다: `distanceM`, `restMin`, `speedMps`. 좌표는 `[경도, 위도]` 순서.
- `any` 금지. 주석은 "왜"를 한국어로 짧게. 주변 코드의 이름 짓기와 스타일을 따른다.
- 새 의존성을 추가하면 PR 설명에 이유를 적는다.

## 5. 테스트

- `lib/engine`, `lib/geo`의 계산, `lib/ai`의 응답 파싱, API의 권한 검사는 vitest 테스트를 함께 쓴다.
- 판정·속도 계산을 바꾸면 기대 숫자가 들어간 테스트를 먼저 고치거나 추가한다.
- 외부 API(TMAP, Upstage, TourAPI)는 테스트에서 실제로 부르지 않는다. 저장해 둔 응답이나 가짜 함수로 대신한다.

## 6. 서비스 원칙 (어기면 버그로 본다)

- **"계단 없음"은 `confirmed_none`일 때만 쓴다.** 기록이 없으면 "계단 기록 없음 (지도 데이터 기준)".
- **걷는 시간·계단 수·판정은 계산 엔진에서만 나온다.** AI가 숫자를 만들거나 판정을 바꾸게 하지 않는다. AI 문장에는 엔진 결과의 숫자만 넣는다.
- 모든 시간은 범위("약 15~20분")와 '추정치' 표시. 판정 근거에는 출처와 확인 날짜.
- 장소 데이터에는 출처, 확인 날짜, 신뢰 등급(A/B/C)을 항상 붙인다.
- 화면: 큰 글씨, 쉬운 말, 가/가+ 버튼, 상태는 색과 글자를 함께.
- AI 추천은 우리 장소 DB 안에서만.

## 7. 키와 비밀 정보

- 키는 `.env.local`에만 둔다. 커밋, 채팅, AI 프롬프트에 키 값을 붙여넣지 않는다.
- 새 환경 변수를 추가하면 `.env.example`에 이름만(값 없이) 추가한다.
- 키는 서버 코드에서만 읽는다. `NEXT_PUBLIC_`을 붙이는 값에 비밀을 넣지 않는다.

## 8. 브랜치와 PR

- **`main`에는 직접 push할 수 없다.** 모든 변경은 브랜치 → PR → **다른 팀원 중 한 명의 승인** → 머지. 모두가 승인할 필요는 없다. (GitHub 브랜치 보호로 강제된다. 자기 PR은 자기가 승인할 수 없다.)
- **예외: 레포 관리자 김태형은 PR 없이 `main`에 바로 push할 수 있다** (공통 문서·설정 정리용). 기능 코드는 김태형도 브랜치 → PR로 올리는 것을 원칙으로 한다.
- **각자 자기 브랜치에서만 작업한다.** 이름은 `접두어/내용` — 예) `fe/trip-screen`, `acct/invite-link`, `ai/engine-speed`, `geo/places-pilot`. 기능 하나에 브랜치 하나, 작게.
- 커밋 메시지: `종류(접두어): 내용` — 예) `feat(acct): 초대 링크 만들기`. 종류는 feat, fix, refactor, test, docs, chore, data.
- PR을 올리기 전에 `main`의 최신 내용을 받아 충돌을 풀고(`git pull origin main` 또는 rebase), 2장의 검사를 통과시킨다.
- PR 설명은 `.github/pull_request_template.md` 양식대로: 무엇을, 왜, 어떻게 확인했는지(테스트·화면 캡처), 다른 역할에 영향 주는 것.
- 승인은 팀원 한 명이면 된다. 다만 `src/lib/contracts`나 다른 역할의 폴더를 건드렸으면 그 담당을 리뷰어로 넣어 알리고, 가능하면 그 사람의 승인을 받는다.
- 승인 후 머지는 **PR을 올린 사람이** 한다(squash merge). 새 커밋을 올리면 이전 승인은 무효가 되니 다시 승인받는다.
- **AI 도구의 권한**: 작업 브랜치 만들기는 바로 해도 된다. 커밋·push·PR 생성은 사용자가 시킬 때만 한다. 머지·승인·force push는 하지 않는다. `main` push는 사용자가 김태형이고 직접 시킬 때만 한다.
- **DB는 각자 로컬 PGlite**(`.pglite` 폴더, `DATABASE_URL`을 비워 두면 자동)로 개발한다. Neon은 마지막 배포 때만 연결한다. 마이그레이션 파일(`drizzle/`)은 커밋하고, `pnpm db:migrate`·`db:studio` 전에는 개발 서버를 끈다(PGlite는 한 번에 한 프로그램만 연다). 데이터를 지우는 마이그레이션은 팀에 먼저 알린다.
- `db.transaction()`은 쓰지 않는다. 배포에서 쓰는 Neon HTTP 드라이버가 지원하지 않는다. 꼭 필요하면 팀에 말한다(배포 때 드라이버를 바꿔야 함).

## 9. 막히면

- 30분 이상 막히면 팀에 공유한다(노션 팀 규칙).
- 설계 문서·역할 문서에 없는 결정이 필요하면 추측으로 구현하지 말고 사용자에게 묻는다. 정해지면 문서에 적는다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
