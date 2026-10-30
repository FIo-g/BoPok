# 역할: 프론트엔드 — 오하연

브랜치 접두어 `fe/` · 설계 문서 3장(화면 원칙), 4장(흐름·화면), 5장(의견), 9장(지도), 12장(시안 이식)

## 한 줄

모든 화면과 지도를 만든다. 일정 화면에서는 계산 엔진을 브라우저에서 직접 불러, 일정이 바뀔 때마다 바로 다시 판정하고 지도를 갱신한다.

## 맡는 폴더

`src/app/**/page.tsx`, `layout.tsx`, `src/components/**`, `src/lib/api-client`, `src/mocks`, `public/**`, `scripts/map`

## 설계 가이드

### 화면과 경로

| 경로 | 화면 | 쓰는 API |
| --- | --- | --- |
| `/` | 첫 화면 (시안 3D 대전 히어로 재사용 가능) | — |
| `/signup`, `/login` | 가입·로그인 | Better Auth (김경선) |
| `/groups` | 내 그룹 목록, 새 그룹 | `GET/POST /api/groups` |
| `/invite/[token]` | 초대 받기 (로그인 안 했으면 로그인 후 돌아오기) | `GET /api/invites/:token`, `POST .../accept` |
| `/groups/[id]` | 여행 목록(작성 중/확정), 구성원, 초대 링크 | `GET /api/groups/:id`, `GET /api/groups/:id/trips`, `POST /api/groups/:id/invites` |
| `/trips/new?group=` | A/B 선택 → (B) 스타일·예산 → 인터뷰 대화창 | `POST /api/trips`, `POST /api/ai/parse-schedule`, `POST /api/ai/interview`, `POST /api/ai/generate` |
| `/trips/[id]` | 일정 화면 (1:1 분할, 아래) | trips·versions·opinions·legs·places·ai/revise |
| `/trips/[id]/travelers` | 함께 가는 사람·걷기 조건 고치기 (부모님 본인 입력) | `PUT/PATCH /api/trips/:id/travelers` |
| `/trips/[id]/final` | 확정 일정, 지도, 가족에게 보내기 | `GET /api/trips/:id/share-text` |

### API 호출과 목업

- 모든 API 호출은 `src/lib/api-client`에 모은다. 요청·응답 타입은 `src/lib/contracts`에서 가져온다.
- `NEXT_PUBLIC_USE_MOCKS=1`이면 api-client가 `src/mocks`의 데이터를 돌려준다. 백엔드가 준비되기 전에도 모든 화면을 끝까지 만들 수 있게 한다.

### 일정 화면 `/trips/[id]` (서비스의 중심, 오하연 시안 영상 기준)

- **왼쪽**: 버전 선택(번호, 누가/AI가 만들었는지, 확정 표시) · 판정 이유 한 문장 + 배지 · 요약 카드(하루 총, 가장 긴 연속, 조건 대비) · "계단 기록이 없는 구간 n곳 · 지도 데이터 기준"(계단 피하기일 때) · 이전 버전 대비 바뀐 점 한 줄 · 일정 목록(시간, 머무는 시간, 걷는 시간 범위, 계단, 쉼터 실내/야외, 출처) · 장소별 반응 버튼 + 한 줄 의견 · 조건 바꿔 보기 · 버튼(의견 반영해서 다시 짜기 / 빠른 수정안 / 직접 고치기 / 확정)
- **오른쪽**: 지도 — 경로선, 부담 구간 색, "! 계단 24칸", 쉼터 핀(실내/야외), 주차장·정류장 핀, 2D/3D, 구간만 보기. 목록에서 구간을 고르면 지도가 이동하고, 지도에서 고르면 목록이 펼쳐짐
- **좁은 화면**: 지도를 위, 일정을 아래로 쌓는다
- **즉시 재판정 흐름**: 편집 중인 stops가 바뀔 때마다(디바운스 200~300ms)
  1. `engine.requiredLegs(stops, places)`로 필요한 경로 목록을 얻고, 없는 것만 `POST /api/legs`로 받아 캐시
  2. `engine.judge(input)` → 결과로 목록·요약·지도를 그림
  3. "저장"을 눌러야 새 버전이 된다 (`POST /api/trips/:id/versions`)
- **직접 고치기**: 순서 바꾸기, 빼기, 장소 목록에서 더하기·바꾸기(`GET /api/places`), 시간, 장소 사이 이동수단, 꼭 갈 곳·예약 표시
- **빠른 수정안**: `engine.quickFixes(input)`가 돌려준 A·B·C 카드를 보여 주고, 고르면 그 stops로 새 버전 저장
- **의견**: 화면을 열어 둔 동안 15초쯤마다 `GET /api/versions/:vid/opinions`로 새로 불러온다

### 지도 (`src/components/map/`)

- 시안 레포 `Bopok`에서 옮긴다: `components/map/MapView.tsx`, `treesLayer.ts`, `lib/map-geojson.ts`, `map-config.ts`, `map-focus.ts`, `map-limits.ts`(+ 테스트), `public/map`, `public/tiles`, `public/data`, 지도 데이터 스크립트(→ `scripts/map`)
- maplibre-gl, three는 이 폴더에서만 import한다. MapView에는 경로 GeoJSON, 핀 목록, 맞출 범위, 2D/3D 같은 값만 넘긴다
- 경로 GeoJSON은 `JudgeResult`(구간별 상태)와 장소 구간·경로의 `path`로 만든다 (시안 `buildRouteGeoJSON`을 새 타입에 맞게 고침)
- 지도 로딩에 실패해도 목록만으로 모든 정보를 볼 수 있어야 한다
- 원본 SHP는 레포에 없다. 건물 타일을 다시 만들 일이 있을 때만 필요

### 인터뷰 화면

- 대화창 + 질문마다 큰 선택 버튼(칩) + 직접 입력. `POST /api/ai/interview` 응답의 `{ text, choices, slot, done }`을 그대로 그린다
- 스타일 칩: 관광·명소, 레저·체험, 휴식·힐링, 자연·산책, 맛집·음식, 문화·역사, 과학·전시, 온천·스파, 사진 명소, 쇼핑, + 기타 직접 입력. 예산 칩: ~3만 / 3~5만 / 5~10만 / 10만 원~ (1인당 하루)

### 공통 화면 원칙

큰 글씨, 쉬운 말, 모든 화면 위 가/가+ 버튼(루트 글자 크기 전환, 저장은 localStorage), 상태는 색과 글자를 함께, 시간은 "약 15~20분 · 추정치", 출처·확인 날짜 표시. 공유는 Web Share API, 안 되면 복사하기.

## 받는 것 / 주는 것

- 받는 것: `src/lib/contracts`(모두), API(김경선·김태형·이동주), `src/lib/engine`(김태형)
- 주는 것: `src/mocks` 데이터, 화면을 만들며 발견한 contracts 수정 요청

## 작업 순서

| 단계 | 할 일 | 완료 기준 |
| --- | --- | --- |
| 0 | `common.md` 0단계: contracts 리뷰, `src/mocks` 작성, api-client 뼈대 | 목업 모드로 데이터를 불러옴 |
| 1 | 공통 레이아웃, 가/가+ 버튼, 가입·로그인 화면 | 목업으로 화면 이동 |
| 2 | 내 그룹, 그룹, 초대 받기 화면 | 목업으로 그룹 만들기·초대 흐름이 보임 |
| 3 | 지도 이식 (`Bopok` → `src/components/map`) | 대전 3D 지도에 목업 경로·핀이 그려짐 |
| 4 | 일정 화면 (목업 + 엔진 연결, 즉시 재판정, 직접 고치기, 조건 바꿔 보기) | stops를 바꾸면 숫자·지도가 바로 바뀜 |
| 5 | 새 여행 + 인터뷰 화면 | 목업 인터뷰로 끝까지 진행 |
| 6 | 의견, 버전 비교, 빠른 수정안, 확정, 공유 | 의견 → 다시 짜기 → 새 버전 → 확정 흐름 |
| 7 | 실제 API로 전환 (목업 끄기), 좁은 화면 정리 | 합치기 순서 1~3 통과 |

## 주의

- "계단 없음"은 `stairsStatus === 'confirmed_none'`일 때만 표시한다. `unknown`은 "계단 기록 없음 (지도 데이터 기준)".
- 걷는 시간·판정 숫자를 화면에서 따로 계산하지 않는다. 항상 `engine` 결과를 그린다.

## 진행 상황 (프론트)

| 단계 | 상태 | 메모 |
| --- | --- | --- |
| 0 | 완료 | contracts 리뷰(아래), `src/mocks`(한밭수목원·국립중앙과학관·대전시립미술관 + 후보 3곳, 버전 3개, 의견 4개), `src/lib/api-client` |
| 1 | 완료 | 공통 레이아웃, 가/가+ 버튼, 가입·로그인 |
| 2 | 완료 | 내 그룹, 그룹, 초대 받기 |
| 3 | 완료 | 지도 이식: `src/components/map`, 데이터·스크립트는 `scripts/map`(README 참고) |
| 4 | 완료 | 일정 화면(즉시 재판정, 직접 고치기, 조건 바꿔 보기, 빠른 수정안, 의견, 버전 비교, 목록 ↔ 지도 연동) |
| 5 | 완료 | 새 여행(붙여넣기·처음부터) + 인터뷰 대화창 |
| 6 | 완료 | 의견·다시 짜기·버전 비교·확정·공유, 함께 가는 사람 고치기 |
| 7 | 서버 대기 | 실제 API 호출은 `src/lib/api-client/real.ts`에 이미 있음. 서버 API가 머지되면 `NEXT_PUBLIC_USE_MOCKS`를 비워 확인한다 |

### contracts 리뷰에서 더한 것 (그룹·여행 API)

화면을 만들다 보니 contracts에 없는 모양이 있어 `group.ts`, `trip-api.ts`를 더했다. 이름·칸은 담당(김경선)이 서버에 맞게 고쳐도 된다.

- `User`, `Group`, `GroupSummary`(내 역할·구성원 수), `GroupDetail`(구성원), `Invite`, `InvitePreview`, `AcceptInviteResponse`(`{ groupId }`)
- `Trip`(제목·날짜·모드·이동수단·스타일·예산·**확정 버전·확정한 사람 이름**), `TripDetail`, `TripListItem`(최신·확정 버전 요약)
- `VersionSummary`(stops 없는 버전 + **만든 사람 이름** `madeByName`) — 버전 선택 줄에 "누가 만들었는지"를 보여 주려고
- 요청 본문: `CreateTripRequest`, `UpdateTripRequest`, `PutTravelersRequest`, `SaveVersionRequest`, `ConfirmRequest`, `ShareTextResponse`, `PlaceDetailsRequest`, `LegsRequest`

화면이 서버에 기대는 점 (서버 구현 때 확인 부탁):

- 로그인 응답은 Better Auth 기본 모양(`{ user: { id, name, email } }`)이고, 세션이 없으면 `/api/auth/get-session`이 `null`을 준다
- `POST /api/legs` 응답은 요청과 **같은 순서**의 `Leg[]` (화면이 순서로 짝을 맞춘다)
- 여행자가 아직 없는 여행(붙여넣기 직후)에도 버전 저장이 되어야 하고, 이때 판정 요약은 `null`이다
- 인터뷰가 `done`이 되면 서버가 여행자·스타일·예산·날짜·이동수단을 여행에 저장한다 (화면은 `filled`를 다시 보내지 않는다)
