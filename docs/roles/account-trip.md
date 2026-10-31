# 역할: 계정·그룹 + 여행·버전·의견 — 김경선 (P1, P2)

브랜치 접두어 `acct/` · 설계 문서 4장(흐름), 5장(의견), 6.3 끝 '여행자 정보 고치기', 10.3(DB), 10.4(권한)

## 한 줄

가입·로그인·그룹·초대와, 여행·여행자·버전·의견·확정을 서버에 저장하고 꺼내는 일을 맡는다. 다른 백엔드 역할이 쓰는 "버전 저장" 함수의 주인이기도 하다. 0단계 레포·DB 준비를 주도한다.

## 맡는 폴더

`src/app/api/{auth,groups,invites,trips,versions,opinions}/**`, `src/lib/auth`, `src/lib/groups`, `src/lib/trips`, `src/lib/db/client.ts`, `src/lib/db/schema/{auth,groups,trips}.ts`

## 설계 가이드

### 로그인 (Better Auth)

- 이메일·비밀번호 + 이름. 비밀번호 찾기·이메일 인증·소셜 로그인은 MVP에서 뺀다
- Drizzle 어댑터로 Neon에 저장, 핸들러는 `src/app/api/auth/[...all]/route.ts`
- `src/lib/auth`에 서버 함수: `requireUser(request)`(로그인 안 했으면 401), `requireMember(request, groupId)`(구성원 아니면 403), `requireOwner(request, groupId)`
  - 쿠키를 `request.headers`에서 읽으므로 route 핸들러가 받은 `request`를 그대로 넘긴다. 그래야 테스트에서 가짜 함수 없이 쿠키를 끼워 넣을 수 있고, 김태형의 `requireTripMember(request, tripId)`에 바로 끼워진다 **[결정: 김경선 10/30]**
  - 구성원이 아닐 때와 그룹이 아예 없을 때 모두 403으로 답한다 — 404로 나누면 '그 그룹이 있긴 하다'는 사실이 새어 나간다 **[결정: 김경선 10/30]**
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
| `POST /api/invites/:token/accept` | 참가 `{ relation? }` (이미 구성원이면 그대로 성공 — role·relation을 덮어쓰지 않는다) | 로그인 |
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

5단계에서 정한 것 **[결정: 김경선 10/31]**:
- 의견 API는 버전 id만 받으므로 **버전 → 여행 → 그룹**을 따라가 구성원인지 본다(`requireVersionMember`). 버전이 없으면 404, 남의 그룹 버전이면 403.
- `userName`은 세션에서 채운다. 클라이언트가 몸체로 보낸 이름·`userId`는 쓰지 않는다.
- **의견 지우기는 두 단계 순서가 중요하다: ① 지금도 그 그룹 구성원인지 → ② 그다음 내 의견인지.** 그룹에서 내보내진 사람은 예전에 남긴 자기 의견도 지울 수 없고(403), 남이 남의 의견 id를 넣어도 '내 의견이 아니다'는 사실조차 알 수 없다. 순서를 뒤집으면 그 정보가 새어 나간다 — 테스트로 고정했다.
- 확정은 여행당 한 버전. `trips.confirmed_version_id` 한 칸이라 다른 버전을 확정하면 **덮어써지며 이전 확정이 자동으로 풀린다**. 다른 여행의 버전으로 확정하면 400 "확정할 버전을 찾을 수 없어요"(목업과 같은 문구). 확정·풀기는 구성원 누구나 할 수 있고(설계 10.4), 풀기는 이미 풀린 상태에서도 성공한다(멱등).
- `confirmedByName`은 `confirmed_by_user_id`의 `user.name`을 이어 붙여 만든다(저장하지 않는다 — 이름이 바뀌면 따라 바뀌어야 한다).
- `createVersion`의 `appliedOpinionIds` 가운데 **그 여행의 의견이 아닌 id는 건너뛰고 서버 로그에만 남긴다**. 400으로 막으면 AI가 방금 만든 새 일정이 통째로 날아가는데, 잘못된 id는 곁가지 정보라서 그만한 값이 없다.
- 공유 글(`share-text`)은 7단계로 미뤘다.

4단계에서 정한 것 **[결정: 김경선 10/31]**:
- 버전 번호는 여행마다 1부터. `db.transaction()`을 못 쓰므로(Neon HTTP) **`(trip_id, number)` 유니크 제약 + 겹치면 다시 세어 넣기(최대 5회)**로 막는다. 두 명이 동시에 저장해도 번호가 겹치거나 빠지지 않는다.
- `POST /api/trips/:id/versions`(화면)와 `createVersion`(AI)이 **같은 저장 함수**를 쓴다. 번호·`parentId` 검사가 한 곳에만 있다.
- `parentId`는 같은 여행의 버전이어야 한다. 아니면 **400 "이전 버전을 찾을 수 없어요"**(목업과 같은 코드·문구). `GET .../versions/:vid`에서 다른 여행의 버전 id면 **404 "버전을 찾을 수 없어요"**.
- 버전 목록은 **번호 오름차순**이고 `latestVersion`은 마지막이다(목업 `versionsOf`와 같은 규칙). 목록용 요약에는 `stops`가 없고 `madeByName`(= `madeByUserId`의 이름)을 서버가 채운다.
- `trips.confirmed_version_id`에 외래키를 걸었다. `trips`와 `trip_versions`가 서로를 가리키므로 스키마에서 `AnyPgColumn`으로 타입 순환을 끊는다.
- `version_opinions` 표는 4단계에 같이 만들었다(마이그레이션을 두 번 만들지 않으려고). **의견 API와 `createVersion`의 `appliedOpinionIds` 연결은 5단계**다. `getOpinions(versionId)`는 AI가 기다리는 함수라 4단계에 먼저 만들었다 — 의견이 없으면 빈 배열이 정상이다.
- 판정 요약(`judge_summary`)은 6단계에서 채운다. 그때까지 `null`로 저장한다.

3단계에서 정한 것 **[결정: 김경선 10/31]**:
- `trips`에 `status` 칸을 두지 않는다. 계약(`trip-api.ts`)에 없고 `confirmedVersionId === null`이면 '작성 중'이다. 칸이 둘이면 서로 어긋난다(설계 10.3의 `status` 제안을 쓰지 않음).
- 날짜는 `date({ mode: 'string' })`로 `'YYYY-MM-DD'` 문자열을 주고받는다. `Date`로 받으면 시간대 때문에 하루 밀린다.
- `trip_travelers`의 기본키는 `(trip_id, id)`다. `id`는 화면·AI가 만들어 보내는 값이라 여행마다 `t1` 같은 짧은 값이 올 수 있다.
- `trip_travelers.sort_order`를 둔다. 계약 `Traveler`에 순서 칸이 없어 화면은 배열 순서를 믿는다.
- **몸체의 `filledBySelf`와 `userId`는 믿지 않는다** (판정 근거를 꾸밀 수 없게):
  - `filledBySelf`는 서버가 정한다. `PATCH`·`PUT` 모두 '저장하는 사람이 그 여행자와 연결된 본인인지'로 정하고, 본인이 아니면 `PUT`은 기존 값을 유지(새 여행자는 `false`), `PATCH`는 `false`. 화면의 여행자 편집이 `PUT`만 쓰므로 부모님이 자기 계정으로 자기 칸을 저장하는 길이 `PUT`이다.
  - `userId`(계정 연결)는 `PATCH`로 바꿀 수 없다. `PUT`으로 목록을 통째로 저장할 때만 바꾸며, 그때 **그 그룹 구성원이 아닌 계정이면 400**.
- `PATCH`로는 나이·키·성별을 비울 수 없다(계약이 `optional`이라 `null`을 받지 않는다). 비우려면 `PUT`으로 목록을 다시 저장한다.
- 여행 API는 모두 여행의 `groupId`로 `requireMember`를 거친다. **없는 여행도 403**으로 답한다(404로 나누면 그 여행이 있다는 사실이 새어 나간다).

2단계에서 정한 것 **[결정: 김경선 10/30]**:
- 참가할 때 `relation`을 선택 값으로 받는다. 설계 10.3의 `group_members.relation`을 채우는 곳이 다른 데 없어서, 안 받으면 그 칸이 영원히 빈다. 안 보내도(또는 `null`로 보내도) 참가는 된다.
- `GroupDetail`에 `myRole`을 넣는다. 상세 화면이 '초대 링크 만들기'·'내보내기' 버튼을 보여줄지 이것만 보고 정하게.
- 내보내기는 두 겹으로 막는다: 그룹장이 자기 자신을 내보내면 400, 내보낸 뒤 그룹장이 0명이 되면 400. 그룹장 넘기기·그룹 삭제·스스로 나가기는 MVP 밖.
- 초대 링크의 전체 주소는 프론트가 만든다(`location.origin + '/invite/' + token`). API는 `{ token, expiresAt }`만 준다.

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
| 0 | 레포 초기화·DB 연결 코드는 이미 main에 있음(김태형). 로컬 DB는 PGlite(설치 없음), Neon·Vercel은 마지막 배포 때. contracts 중 `trip.ts`·`version.ts`(일정·버전·의견) 확인 | `pnpm dev`로 띄우고 로컬 DB에 테이블이 생김 |
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
