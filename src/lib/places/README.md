# 장소 API — 시범 3곳

담당: 이동주. 공개 장소 목록만 제공하며 로그인·그룹·여행 데이터는 조회하지 않는다.
기존 `getDb()`와 통합 DB 스키마(DB PR #1, 머지됨)를 사용한다. OSM 수집·노션 비교와 독립적으로 동작한다.

## 범위

장소 기본정보 API(PR #6, 머지됨)는 시범 3곳의 이름·분류·스타일·대표 좌표·출처를 제공한다.
AI가 쓰는 검색 함수 두 개(`searchCandidates`, `matchPlaceByName`)도 이 폴더에 있다(아래 "AI용 검색 함수").
내부 지점·구간 조사는 후속 작업이다. 장소 사이 보행 경로는 `src/lib/geo/README.md`, TMAP 장소(POI) 검색은 그 문서의 마지막 절을 본다.

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
한글 검색어는 주소에서 인코딩(퍼센트 인코딩)해서 보낸다. 라우트는 한글을 그대로 받아도 200이지만,
Windows PowerShell처럼 클라이언트에 따라 글자가 깨져 전달되면 400이 날 수 있다.

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

## 미완성 정보

장소 ID는 `hanbat`(한밭수목원), `art`(대전시립미술관), `leeungno`(이응노미술관)이다.
주소·연락처·대표 지도 좌표의 근거와 분류 기준은 `data/places/README.md`를 참고한다.
주차장·입구·볼거리·쉼터·화장실 지점과 내부 경로는 아직 조사하지 않아 `nodes: []`,
`segments: []`이다. `visitMin`은 생략한다. 거리·보행 시간·계단 수나 `confirmed_none`을 만들지 않는다.
좌표는 장소 대표 표시이며 **입구 좌표로 검증되지 않았다**. 이동 경로 출발점으로 확정하지 않는다.
빈 내부 경로를 "걷기 0분" 또는 "계단 없음"으로 해석하면 안 된다.
추가 관광지는 아직 없다.

## AI용 검색 함수 (`search.ts`)

AI(김태형)가 후보 장소를 고르고, 붙여넣은 일정의 이름을 장소와 맞출 때 쓰는 서버 함수다.
모두 우리 장소 DB 안에서만 찾고, 걷는 시간·거리·계단 수 같은 숫자를 만들지 않는다.
`index.ts`가 다시 내보내면 순환 import가 되므로 `@/lib/places/search`에서 가져온다.
마지막 인자 `database?`는 테스트용이다. AI에 연결할 때는 `q => searchCandidates(q)`처럼 화살표로 감싸
인자가 새어 들어가지 않게 한다.

| 함수 | 내용 |
| --- | --- |
| `searchCandidates({ styles, budget?, transport, avoidStairs, limit })` → `PlaceSummary[]` | 스타일이 맞는 장소를 앞에 두고 `limit`개를 돌려준다. 안 맞는 장소도 뒤에 붙는다(장소가 적어 거르면 후보가 빈다). |
| `matchPlaceByName(name)` → `PlaceSummary \| null` | 붙여넣은 일정의 이름을 장소와 맞춘다. 못 맞추면 `null`. |

`searchCandidates` 규칙:

- 계단 피하기(`avoidStairs`)면 구간 기록에 계단이 `present`인 구간이 하나라도 있는 장소를 맨 뒤 무리로 보낸다.
  스타일 점수보다 우선하며, 각 무리 안에서는 스타일 점수 → 이름·ID 순이다.
  `unknown`·`confirmed_none`이거나 구간 기록이 없는 장소는 위반이 아니므로 빼지도 뒤로 보내지도 않는다.
  지금 시범 3곳은 구간 기록이 없어 계단 때문에 순서가 바뀌지 않는다. 최종 판정은 계산 엔진이 한다.
- `budget`·`transport`는 형식만 검사하고 순위에는 쓰지 않는다. 장소 데이터에 예산·이동수단 근거 칸이 없다.
  칸이 생기면 `rankPlaces`에 더한다.
- 입력이 잘못되면(`limit` 범위 밖, 모르는 `transport` 등) DB를 읽기 전에 예외를 던진다.

`matchPlaceByName` 규칙:

- 공백·기호·대소문자를 무시하고 이름이 같으면 맞춘다("한밭 수목원" = "한밭수목원").
  입력 안에 장소 이름이 통째로 들어 있어도 맞춘다("10시 한밭수목원 산책").
- 후보가 둘 이상이면 `null`이다. 같은 이름의 장소가 둘이거나, 서로 관계없는 장소 이름이 둘 다 들어 있을 때다.
  이름이 중첩된 경우("대전" ⊂ "대전시립미술관")에만 긴 쪽을 고른다.
- "근처·앞·주변·옆·인근·부근·맞은편·건너편"이 붙은 입력("한밭수목원 근처 식당")은 그 장소로 맞추지 않는다.
- 이름의 일부("미술관")와 두 글자 미만 이름은 맞추지 않는다.
- 별칭: 순수 함수 `findPlaceByName`은 `aliases`가 있는 항목이면 별칭도 본다. 하지만 장소 DB에 별칭 칸이 아직 없어
  `matchPlaceByName`은 지금 이름만 본다. 별칭 칸이 생기면 `listPlaces` 결과에 `aliases`를 싣는다.

AI 쪽 연결은 아직 아니다. 지금 `src/lib/ai/place-adapters.ts`가 `listPlaces`로 임시 구현을 하고 있으며,
이 함수들로 바꾸는 일은 AI 담당(김태형)이 배포 뒤에 한다. 이름 맞추기는 임시 구현보다 더 보수적이다
(기호 무시, 근처 계열 말 거부, 관계없는 장소 둘이면 `null`).

## 검사

```powershell
pnpm exec vitest run src/lib/places
pnpm lint
pnpm test
pnpm build
pnpm typecheck
```

장소 API 테스트(`places.test.ts`)와 검색 함수 테스트(`search-db.test.ts`)는 실제 마이그레이션과 메모리 PGlite로 실행한다.
`search.test.ts`는 DB 없이 순위·이름 맞추기 계산만 검사한다. 외부 API·외부 DB·디스크 DB는 열지 않는다.
PGlite 초기화가 오래 걸려 `beforeAll` 제한을 30초로 두었다. 느린 PC에서 훅 제한 시간 오류가 나면
`pnpm test --maxWorkers=2`로 다시 확인한다(테스트를 제외하거나 제한을 늘리지 않는다).
기존 응답 계약과 여러 상세 요청 계약을 재사용하며, `contracts/place.ts`에는 목록 입력과 ID 검사만 추가했다.
공용 계약 파일을 포함한 PR은 프론트 오하연과 관련 백엔드 담당 김태형·김경선에게 리뷰를 요청한다.

2026-10-31 `pnpm build`로 만든 서버에서도 실제 로컬 DB를 사용해 9개 HTTP 요청을 검증했다.
전체 목록 3곳, 검색·스타일 필터 결과 2곳, 각 상세 3곳, 중복·누락 ID가 있는 일괄 상세,
없는 상세 404, 잘못된 본문 400, JSON이 아닌 요청 415를 확인했다.
성공 응답은 공용 계약과 출처·날짜·등급을 통과했고, 미조사 시간이나 `confirmed_none`은 없었다.
