# 장소 API — 시범 3곳

담당: 이동주. 공개 장소 목록만 제공하며 로그인·그룹·여행 데이터는 조회하지 않는다.
기존 `getDb()`와 DB PR #1의 통합 스키마를 사용한다. OSM 수집·노션 비교와 독립적으로 동작한다.

## 공유 단위와 DB PR 의존성

이 브랜치의 공유 범위는 시범 3곳의 **기본정보 API**다. 내부 지점 조사는 후속 작업이다.
2026-10-31 확인 시 [DB PR #1](https://github.com/FIo-g/BoPok/pull/1)은 미병합이며,
`geo/places-api`는 `geo/place-schema`를 기반으로 한다. API PR의 base도
`geo/place-schema`로 지정해 DB 변경과 API 변경을 분리한다.
DB PR 병합 후에는 최신 `main`과 마이그레이션 이력을 확인하고 API PR의 base를 다시 정리해야 한다.
프론트는 그 전에도 `origin/geo/places-api`가 포함된 별도 체크아웃에서 아래 명령으로 연동할 수 있다.
`main`에는 장소 스키마가 아직 없으므로 API 파일만 따로 가져오면 동작하지 않는다.

## 로컬 실행 (PowerShell, 프로젝트 루트)

```powershell
pnpm install --frozen-lockfile
# 개발 서버와 DB 도구를 끈 상태에서 실행: 마이그레이션 + 장소 적재
node --conditions=react-server scripts/data/load-places.mjs
$env:DATABASE_URL = ''
$env:PGLITE_DIR = '.pglite/places-api'
$env:NEXT_PUBLIC_USE_MOCKS = '0'
pnpm dev
```

Windows 실행 정책이 `pnpm.ps1`을 막으면 `pnpm.cmd`를 사용한다.
장소 전용 로컬 DB는 `.pglite/places-api`이며 기존 `.pglite` 실험 DB는 옮기거나 지우지 않는다.
다른 경로로 개발 서버를 실행하면 적재한 장소가 보이지 않는다. 기존 프론트 목업은 변경하지 않았으므로
`NEXT_PUBLIC_USE_MOCKS=1`인 서버는 종료한 후 위 설정으로 다시 실행한다.

## 요청과 응답

| API | 성공 응답 | 규칙 |
| --- | --- | --- |
| `GET /api/places?styles=&q=` | `PlaceSummary[]` | `q`는 이름 부분 검색, `styles`는 쉼표 구분. 스타일 중 하나 일치(OR), 이름 조건과는 AND. 이름·ID 순 정렬. |
| `GET /api/places/:id` | `PlaceDetail` | 없는 ID는 404. |
| `POST /api/places/details` | `PlaceDetail[]` | JSON `{ "ids": [...] }`. 최대 100개. 요청 순서 유지, 중복 ID는 첫 번째만, 없는 ID는 제외. 빈 배열은 `[]`. |

빈 검색 조건은 전체 목록을 반환한다. 결과 없음은 200과 `[]`이다.
검색어는 최대 100자, 스타일은 최대 10개·각 30자이며 `%`, `_`, `\`도 문자 그대로 검색한다.
ID는 영문·숫자로 시작하는 영문·숫자·밑줄·하이픈 문자열(최대 100자)이다.
잘못된 입력·JSON·16 KiB 초과 본문은 400, JSON이 아닌 POST는 415이다.
서버 또는 응답 계약 검사 실패는 내부 정보를 숨기는 500이다. 오류는 공용
`{ "error": { "code": "...", "message": "..." } }` 모양이며 응답은 `no-store`이다.
한글 검색어는 주소에서 인코딩(퍼센트 인코딩)해야 한다. 그대로 보내면 400이다.

```powershell
Invoke-RestMethod "http://localhost:3000/api/places?q=$([uri]::EscapeDataString('미술관'))"
# 같은 주소: http://localhost:3000/api/places?q=%EB%AF%B8%EC%88%A0%EA%B4%80
curl 'http://localhost:3000/api/places?q=%EB%AF%B8%EC%88%A0%EA%B4%80'
Invoke-RestMethod 'http://localhost:3000/api/places/hanbat'
Invoke-RestMethod 'http://localhost:3000/api/places/details' -Method Post -ContentType 'application/json' -Body '{"ids":["leeungno","hanbat","art"]}'
```

`GET /api/places/hanbat`의 실제 로컬 검증 응답:

```json
{
  "source": "https://www.daejeon.go.kr/gar/contentsHtmlView.do?menuSeq=8026",
  "checkedAt": "2026-10-31",
  "confidence": "B",
  "id": "hanbat",
  "name": "한밭수목원",
  "category": "수목원",
  "styles": ["자연·산책", "휴식·힐링"],
  "coord": [127.387876, 36.365932],
  "seated": false,
  "indoor": false,
  "address": "대전광역시 서구 둔산대로 169",
  "phone": "042-270-8452",
  "homepage": "https://www.daejeon.go.kr/gar/index.do",
  "nodes": [],
  "segments": []
}
```

## 미완성 정보와 검사

장소 ID는 `hanbat`(한밭수목원), `art`(대전시립미술관), `leeungno`(이응노미술관)이다.
주소·연락처·대표 지도 좌표의 근거와 분류 기준은 `data/places/README.md`를 참고한다.
주차장·입구·볼거리·쉼터·화장실 지점과 내부 경로는 아직 조사하지 않아 `nodes: []`,
`segments: []`이다. `visitMin`은 생략한다. 거리·보행 시간·계단 수나 `confirmed_none`을 만들지 않는다.
좌표는 장소 대표 표시이며 **입구 좌표로 검증되지 않았다**. 이동 경로 출발점으로 확정하지 않는다.
빈 내부 경로를 "걷기 0분" 또는 "계단 없음"으로 해석하면 안 된다.
장소 사이 경로, AI 후보 검색·이름 매칭, 추가 관광지는 이번 구현 범위에 없다.

```powershell
pnpm exec vitest run src/lib/places/places.test.ts
pnpm lint
pnpm test
pnpm build
pnpm typecheck
```

API 테스트는 실제 마이그레이션과 메모리 PGlite로 실행한다. 외부 API·외부 DB·디스크 DB는 열지 않는다.
기존 응답 계약과 여러 상세 요청 계약을 재사용하며, `contracts/place.ts`에는 목록 입력과 ID 검사만 추가했다.
공용 계약 파일을 포함한 PR은 프론트 오하연과 관련 백엔드 담당 김태형·김경선에게 리뷰를 요청한다.

2026-10-31 Windows 로컬 검증 결과는 다음과 같이 구분한다.

| 실행 | 결과 |
| --- | --- |
| 장소 API 전용 테스트 | 1개 파일, 24개 통과 |
| 기본 `pnpm test` | 35개 파일 통과, 2개 파일 초기화 실패. 테스트 529개 통과, 초기화 실패로 18개 미실행 |
| `pnpm test --maxWorkers=2` | 37개 파일, 전체 547개 통과 |
| API 작업 전 기준 커밋 `624907b` 비교 | 36개 파일, 523개 통과 |

기본 실행의 실패 파일은 `src/lib/auth/session.test.ts`와
`src/lib/auth/signup-login.test.ts`다. 두 파일 모두 PGlite 초기화가 있는 `beforeAll`에서
기존 10초 훅 제한을 넘겼다. 작업자 수를 줄인 결과는 병렬 부하 가설을 뒷받침하지만,
**병렬 부하가 확정 원인은 아니며 원인 조사는 미완료**다.
작업자 제한 실행도 모든 검사를 실행했으며, 테스트 제외·검사 축소·제한 시간 변경은 하지 않았다.
기본 명령의 실패가 해결되었다고 간주하지 않는다. 계정·레포 담당과 확인할 남은 문제이며,
이번 API PR은 Draft로 공유한다.

같은 날 `pnpm build`로 만든 서버에서도 실제 로컬 DB를 사용해 9개 HTTP 요청을 검증했다.
전체 목록 3곳, 검색·스타일 필터 결과 2곳, 각 상세 3곳, 중복·누락 ID가 있는 일괄 상세,
없는 상세 404, 잘못된 본문 400, JSON이 아닌 요청 415를 확인했다.
성공 응답은 공용 계약과 출처·날짜·등급을 통과했고, 미조사 시간이나 `confirmed_none`은 없었다.
`pnpm lint`, `pnpm typecheck`, `pnpm build`도 통과했다.
