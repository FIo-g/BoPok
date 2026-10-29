# 역할: 계정·그룹 + 여행·버전·의견 — 김경선 (P1, P2)

브랜치 접두어 `acct/` · 설계 문서 4장(흐름), 5장(의견), 6.3 끝 '여행자 정보 고치기', 10.3(DB), 10.4(권한)

## 한 줄

가입·로그인·그룹·초대와, 여행·여행자·버전·의견·확정을 서버에 저장하고 꺼내는 일을 맡는다. 다른 백엔드 역할이 쓰는 "버전 저장" 함수의 주인이기도 하다. 0단계 레포·DB 준비를 주도한다.

## 맡는 폴더

`src/app/api/{auth,groups,invites,trips,versions,opinions}/**`, `src/lib/auth`, `src/lib/trips`, `src/lib/db/client.ts`, `src/lib/db/schema/{auth,groups,trips}.ts`

## 설계 가이드

### 로그인 (Better Auth)

- 이메일·비밀번호 + 이름. 비밀번호 찾기·이메일 인증·소셜 로그인은 MVP에서 뺀다
- Drizzle 어댑터로 Neon에 저장, 핸들러는 `src/app/api/auth/[...all]/route.ts`
- `src/lib/auth`에 서버 함수: `requireUser()`(로그인 안 했으면 401), `requireMember(groupId)`(구성원 아니면 403), `requireOwner(groupId)`
- **모든 API는 이 함수로 권한을 먼저 검사한다.** Neon에는 행 단위 보안이 기본으로 없으므로 서버 코드가 유일한 방어선이다

### 테이블 (설계 10.3, 세부 컬럼은 정해도 됨)

`groups`, `group_members`(role owner|member, relation), `group_invites`(token, expires_at), `trips`, `trip_travelers`, `trip_versions`, `version_opinions`. `trip_interviews`는 김태형이 쓰지만 스키마 파일은 `trips.ts`에 같이 둔다(김태형과 합의해 컬럼 결정).

### API

| 메서드·경로 | 하는 일 | 권한 |
| --- | --- | --- |
| `POST /api/groups` | 그룹 만들기 (만든 사람 = owner) | 로그인 |
| `GET /api/groups` | 내 그룹 목록 | 로그인 |
| `GET /api/groups/:id` | 그룹 + 구성원 | 구성원 |
| `POST /api/groups/:id/invites` | 초대 링크 만들기 (토큰 32바이트 base64url, 7일, 여러 명 사용 가능) | owner |
| `DELETE /api/groups/:id/members/:userId` | 내보내기 | owner |
| `GET /api/invites/:token` | 그룹 이름 미리보기 (만료면 410) | 누구나 |
| `POST /api/invites/:token/accept` | 참가 (이미 구성원이면 그대로 성공) | 로그인 |
| `GET /api/groups/:id/trips` | 여행 목록 + 각 여행의 최신·확정 버전 요약 | 구성원 |
| `POST /api/trips` | 여행 만들기 `{ groupId, title, date, mode: 'paste' \| 'scratch' }` | 구성원 |
| `GET /api/trips/:id` | 여행 + 여행자 + 버전 목록(요약만) | 구성원 |
| `PATCH /api/trips/:id` | 제목·날짜·이동수단·스타일·예산 | 구성원 |
| `PUT /api/trips/:id/travelers` | 여행자 목록 통째로 저장 | 구성원 |
| `PATCH /api/trips/:id/travelers/:tid` | 한 사람 고치기 (본인 계정과 연결된 여행자면 `filledBySelf: true`) | 구성원 |
| `GET /api/trips/:id/versions/:vid` | 버전 전체 (stops 포함) | 구성원 |
| `POST /api/trips/:id/versions` | 직접 고친 일정·빠른 수정안 저장 `{ parentId, stops, madeBy, note }` | 구성원 |
| `GET /api/versions/:vid/opinions` | 의견 목록 | 구성원 |
| `POST /api/versions/:vid/opinions` | 의견 남기기 `{ stopKey, reactions, comment }` | 구성원 |
| `DELETE /api/opinions/:oid` | 내 의견 지우기 | 본인 |
| `POST /api/trips/:id/confirm` | 버전 확정 `{ versionId }` (누가 확정했는지 기록) | 구성원 |
| `DELETE /api/trips/:id/confirm` | 확정 풀기 | 구성원 |
| `GET /api/trips/:id/share-text` | 확정 버전의 공유 글 | 구성원 |

요청·응답 모양은 모두 `src/lib/contracts`에 zod로 정하고, 서버에서 검사한다.

### 다른 역할이 부르는 서버 함수 (`src/lib/trips`)

```ts
// 김태형(AI)이 새 버전을 저장할 때 이 함수를 부른다. 테이블에 직접 쓰지 않게.
createVersion(tripId, { parentId, stops, madeBy, madeByUserId?, note?, appliedOpinionIds? }): Promise<TripVersion>
getTripContext(tripId): Promise<{ trip, travelers, versions }>     // AI가 인터뷰·다시 짜기에 씀
getOpinions(versionId): Promise<Opinion[]>
```

### 버전 저장 시 판정 요약

`createVersion`은 저장 전에 판정 요약을 계산해 함께 저장한다:
1. `src/lib/places`의 `getPlaceDetails(placeIds)` (이동주)
2. `engine.requiredLegs` → `src/lib/geo`의 `getLegs(requests)` (이동주)
3. `engine.judge(input)` (김태형) → `summary`(판정·이유·하루 총·가장 긴 연속)

여행자 조건이 바뀌면 요약이 낡는다. 목록 표시는 요약을 쓰되, 여행자 정보를 고칠 때 그 여행의 버전 요약을 다시 계산해 덮어쓴다. 일정 화면은 어차피 브라우저에서 다시 판정한다.

### 공유 글

시안 `Bopok/src/lib/share-text.ts`와 노션 F10 형식을 따른다(장소 순서·시간, 장소별 걷는 시간, 휴식 위치·쉼터 종류, 탈것 구간, 하루 요약, 연락처, "출발 전 운영 여부 확인"). 숫자는 `engine.judge` 결과에서만.

## 받는 것 / 주는 것

- 받는 것: `engine.judge`·`requiredLegs`(김태형), `getPlaceDetails`·`getLegs`(이동주)
- 주는 것: 로그인·권한 함수(모두), `createVersion`·`getTripContext`·`getOpinions`(김태형), 위 API(오하연)
- 아직 엔진·장소가 없으면 판정 요약은 `null`로 저장하고 진행한다. 나중에 채운다

## 작업 순서

| 단계 | 할 일 | 완료 기준 |
| --- | --- | --- |
| 0 | 레포 초기화·DB 연결 코드는 이미 main에 있음(김태형). Neon·Vercel 연결이 끝나면 이어받아 확인. contracts 중 `trip.ts`·`version.ts`(일정·버전·의견) 확인 | 모두가 `pnpm dev`로 띄우고 DB에 접속 |
| 1 | Better Auth 가입·로그인, `requireUser/requireMember/requireOwner` + 테스트 | 가입 → 로그인 → 세션 확인 |
| 2 | 그룹·구성원·초대 API + 권한 테스트 | 초대 링크로 다른 계정이 참가 |
| 3 | 여행·여행자 API | 여행 만들고 여행자 저장·수정 |
| 4 | 버전 API + `createVersion`(요약은 처음엔 null) | 버전 저장·조회 |
| 5 | 의견 API, 확정·풀기 | 의견 남기고 확정 |
| 6 | 판정 요약 연결 (엔진·장소 준비되면), 여행자 수정 시 요약 재계산 | 목록에 판정 배지가 맞게 나옴 |
| 7 | 공유 글 API | 확정 일정의 공유 글이 노션 형식대로 나옴 |

## 주의

- 남의 그룹 데이터가 보이면 가장 심각한 버그다. API마다 권한 테스트(구성원 아님 → 403)를 쓴다.
- 확정은 여행당 한 버전. 다른 버전을 확정하면 이전 확정은 풀린다.
