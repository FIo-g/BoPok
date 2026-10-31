# 장소 사이 보행 경로 API

담당: 이동주. `geo/legs-api`는 장소 API 커밋 `a79393e`를 기반으로 한다.
기존 장소 API·DB 스키마·공용 계약·엔진·인증 코드는 변경하지 않는다.
현재 구현은 **걷기(walk)·자동차(car)·택시(taxi)** 경로를 받는다. 버스(bus), 택시 요금, AI 검색은 포함하지 않는다.

## 로컬 실행과 키

프로젝트 루트에서 개발 서버와 DB 도구를 종료한 뒤 실행한다.

```powershell
pnpm install --frozen-lockfile
# 장소 API의 기존 적재 명령으로 전용 로컬 DB와 스키마를 준비한다.
node --conditions=react-server scripts/data/load-places.mjs
$env:DATABASE_URL = ''
$env:PGLITE_DIR = '.pglite/places-api'
$env:NEXT_PUBLIC_USE_MOCKS = '0'
pnpm dev
```

Windows 실행 정책에 막히면 `pnpm.cmd`를 사용한다. 기존 DB를 삭제하거나 초기화하지 않는다.
`TMAP_APP_KEY`는 이미 `.env.example`에 있는 서버 환경 변수다. 실제 키는 `.env.local`에만
설정하며, 브라우저 변수·요청 본문·URL·로그·Git에 넣지 않는다. 새 환경 변수와 의존성은 없다.
키가 없어도 목업 테스트는 실행할 수 있다. 유효한 기존 캐시는 키 없이 재사용할 수 있고,
캐시가 없는 보행 요청은 503으로 실패한다.

별도 Node 스크립트는 `.env.local`을 자동 로드하지 않는다. 현재 Node 24에서
일반 실행은 키 미설정, `--env-file=.env.local`을 붙인 실행은 키 설정 상태임을
값을 출력하지 않는 검사로 확인했다. 서버 전용 TypeScript 모듈을 읽는 검증 스크립트에는
다음과 같이 두 옵션을 명시한다.

```powershell
node --env-file=.env.local --conditions=react-server <검증 스크립트>
```

Next 개발 서버는 시작할 때 환경 파일을 읽는다. 이미 실행 중이었다면 키 변경 후 재시작한다.
검증용 Node 프로세스도 새로 실행해야 한다. 환경 파일을 로드하는 것과 실제 API 호출 승인은 별개다.

**키 설정과 실제 호출 승인 후에만** 캐시가 없는 경로로 실호출 검증을 진행한다.
아래 검증 기록은 사용자가 Free 요금제·보행 API 활성·잔여 1건 이상을 확인하고 승인한 1건이다.
키 설정 후 프론트가 API를 호출하면 비용과 한도를
사용할 수 있으므로, 실제 호출 승인 전에는 목업 테스트로만 확인한다.

## 프론트 요청

기존 로그인 세션이 필요하다. `requireUser(request)`로 먼저 검사하며 쿠키는 기존
`api-client`가 같은 출처로 전송한다. 그룹·여행의 개인 데이터를 조회하거나 수정하지 않는다.
기존 로그인 화면에서 로그인한 뒤 호출한다. 별도 Bearer 토큰이나 TMAP 인증 헤더를 프론트에서
만들지 않는다. 직접 `fetch`를 쓴다면 `credentials: 'same-origin'`과
`Content-Type: application/json`을 지정한다. 로컬 서버와 프론트의 호스트를
`localhost`로 통일한다. 별도 출처의 CORS·쿠키 정책은 이번 작업에서 변경하지 않았다.

```ts
import { api } from '@/lib/api-client'
import { legKey } from '@/lib/contracts'
import { requiredLegs } from '@/lib/engine/required-legs'

const requests = requiredLegs(stops, places)
// 서버는 walk·car·taxi를 받고 bus는 미지원이다. 프론트가 어떤 수단을 물을지는 SUPPORTED_LEG_MODES로 정한다. 받지 못한 경로를 성공 경로로 채우지 않는다.
const walkRequests = requests.filter(request => request.mode === 'walk')
const legs = await api.legs.get(walkRequests)
const byKey = Object.fromEntries(legs.map(leg => [leg.key, leg]))
// 응답 key는 legKey(request)와 같으며, 받은 경로만 엔진에 전달한다.
const first = walkRequests[0] ? byKey[legKey(walkRequests[0])] : undefined
```

`POST /api/legs` 본문은 기존 `LegsRequestSchema`의 `{ requests: LegRequest[] }`,
성공 응답은 기존 `LegsResponseSchema`의 `Leg[]`다. 응답을 객체나 성공·실패 묶음으로 바꾸지 않는다.
일부만 실패하면 받은 경로만 담고 실패한 요청은 뺀다. 응답에 key가 없는 요청이 실패한 것이며, 요청과 응답은 순서가 아니라 leg.key로 짝을 맞춘다.
빈 요청은 200과 `[]`다. 최대 20개 요청·16 KiB JSON 본문을 허용한다.
좌표는 `[경도, 위도]`, 선택 ID는 영문·숫자로 시작하는 영문·숫자·밑줄·하이픈(최대 100자)이다.
알 수 없는 필드, 좌표 범위 위반, 잘못된 이동수단은 400이다.

2026-10-31 로그인한 실제 HTTP 요청 예시 (한밭수목원 → 대전시립미술관 대표 좌표):

```json
{
  "requests": [{
    "from": { "coord": [127.387876, 36.365932] },
    "to": { "coord": [127.385754, 36.367080] },
    "mode": "walk"
  }]
}
```

위 요청의 HTTP 200 실제 응답 예시 (이전에 저장한 유효 캐시 재사용):

```json
[
  {
    "key": "127.38788,36.36593>127.38575,36.36708:walk",
    "mode": "walk",
    "distanceM": 318,
    "path": [
      [127.38761459688902, 36.36593384787013],
      [127.38761736318372, 36.36634768943352],
      [127.38762013596275, 36.36652266945181],
      [127.38762289283163, 36.367283693492645],
      [127.3875590096574, 36.367283692358214],
      [127.38750623810849, 36.367228142224654],
      [127.38640355897094, 36.36722812264403],
      [127.38575361711189, 36.36722811110323]
    ],
    "stairsStatus": "unknown",
    "source": "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
    "checkedAt": "2026-10-31",
    "confidence": "B"
  }
]
```

이는 검증 시점의 응답 기록이며 프론트 고정 데이터나 테스트 fixture로 사용하지 않는다.
운영 시에는 API가 반환한 유효 기간 내 결과를 사용한다. `checkedAt`은 수집일의 한국 날짜로,
캐시를 읽을 때마다 오늘 날짜로 갱신하지 않는다.

브라우저 밖에서 재현할 때도 기존 계정으로 로그인하고 같은 세션을 보낸다.
PowerShell 예시는 인증 응답을 표시하지 않고 비밀번호를 명령 기록에 쓰지 않는다.
환경 변수나 인증 헤더를 화면에 표시하는 디버그 옵션을 붙이지 않는다.

```powershell
$base = 'http://localhost:3000'
$credential = Get-Credential -Message '기존 로컬 계정의 이메일과 비밀번호'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{ email = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$null = Invoke-RestMethod -Method Post -Uri "$base/api/auth/sign-in/email" -WebSession $session -ContentType 'application/json' -Headers @{ Origin = $base } -Body $loginBody
Remove-Variable loginBody, credential
$body = @{ requests = @(@{ from = @{ coord = @(127.387876, 36.365932) }; to = @{ coord = @(127.385754, 36.367080) }; mode = 'walk' }) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "$base/api/legs" -WebSession $session -ContentType 'application/json' -Headers @{ Origin = $base } -Body $body | ConvertTo-Json -Depth 8
$null = Invoke-RestMethod -Method Post -Uri "$base/api/auth/sign-out" -WebSession $session -ContentType 'application/json' -Headers @{ Origin = $base } -Body '{}'
Remove-Variable session
```

캐시가 만료되었다면 일반 API는 TMAP을 호출한다. 추가 실호출 없이 검증할 때는
개발 서버 시작 전에 그 프로세스의 `$env:TMAP_APP_KEY = ''`를 설정한다.
이때 유효한 캐시만 성공하고 캐시 미스는 503이다. 환경 파일은 수정하지 않는다.

대표 좌표로 요청한 경로는 그 좌표 사이의 길일 뿐이다. 대표 좌표를 검증된 입구로 바꾸거나
`nodeId: "entrance"`를 생성하지 않는다. 실제 출입 지점·접근 가능한 동선은 별도 확인이 필요하다.

## 오류와 미지원 상태

오류 본문은 모두 기존 `ApiErrorSchema`의 `{ "error": { "code", "message" } }`다.
추가 오류 코드를 공용 계약에 만들지 않고 HTTP 상태로 실패 원인을 구분한다.

| 상태 | code | 의미 |
| --- | --- | --- |
| 400 | `invalid_request` | 잘못된 입력·JSON·요청 수·본문 크기 |
| 401 | `unauthorized` | 미로그인 |
| 415 | `invalid_request` | JSON이 아닌 POST |
| 422 | `invalid_request` | 요청한 경로를 하나도 받지 못했고 첫 실패가 bus 미지원 |
| 503 | `internal_error` | 요청한 경로를 하나도 받지 못했고 첫 실패가 캐시 미스+서버 TMAP_APP_KEY 누락 |
| 502 | `external_api_failed` | 외부 HTTP·통신·JSON·경로 응답 검증 실패 |
| 504 | `external_api_failed` | TMAP 요청 또는 본문 수신이 8초 초과 |
| 500 | `internal_error` | 인증 확인·DB 읽기/저장 등 내부 실패 |

외부 오류 원문·헤더·키는 반환하거나 로그에 출력하지 않는다. 자동 재시도는 없다.
실패한 요청은 직선거리·가짜 선·임시 소요 시간으로 채우지 않고 응답에서 뺀다. 한 건이라도 받으면 200, 하나도 못 받으면 첫 실패의 상태 코드다. 성공한 경로의 캐시는 유지한다. 프론트는 key가 없는 보행 경로를 엔진의 missingLegs/정보 부족 처리로 보여 준다.
미지원 탈것을 walk로 바꿔 다시 요청하거나 걷는 거리·시간을 만들어 채우면 안 된다.

## 자동차·택시 경로와 시간 초과 보호

- `car`와 `taxi`는 [TMAP 자동차 경로안내](https://tmap-skopenapi.readme.io/reference/자동차-경로안내)(`POST https://apis.openapi.sk.com/tmap/routes?version=1`)로 받는다. 보행과 같은 서버 `TMAP_APP_KEY`를 쓰며 새 환경 변수·의존성은 없다. 이 키로 자동차 경로 API를 쓸 수 있는지(상품 활성화·한도)는 아직 확인하지 않았다 — 배포 뒤 첫 호출에서 확인한다. 권한이 없으면 TMAP이 401·403을 주고 서버는 502로 바꿔 돌려준다.
- 요청은 출발·도착 경위도, `WGS84GEO`, 검색 옵션 `0`(교통최적+추천), `trafficInfo: N`이다. 응답은 첫 점의 `totalDistance`(m)·`totalTime`(초)와 이어진 `LineString`만 쓴다. 선이 끊기거나 첫·끝 점과 맞지 않으면 직선으로 잇지 않고 실패(502)로 둔다. 자동차 응답의 `pointType` 이름은 보행(`SP`·`EP`)과 달라서 쓰지 않는다(공식 샘플은 `S`). 응답 모양은 공식 문서와 직접 만든 목업(`fixtures/tmap-car.json`)으로만 확인했고, **실제 응답으로는 아직 확인하지 않았다.** 첫 실호출에서 파서가 거부하면 이 부분(첫·끝 점 좌표 일치)부터 본다.
- `Leg`은 기존 계약 칸만 쓴다: `distanceM`, `durationMin`(= `totalTime` ÷ 60, 반올림 없음), `path`, `source`(자동차 경로 주소), `checkedAt`(수집일의 한국 날짜), `confidence: B`, `stairsStatus: unknown`. 계약 파일과 DB 스키마는 바꾸지 않았다. 엔진은 탈것 구간 시간을 `leg.durationMin`에서 읽는다.
- `durationMin`은 TMAP의 **추정** 소요 시간이다. 호출 시점의 교통 상황이 반영될 수 있고 24시간 캐시를 쓴다. 화면에서는 범위와 '추정치'로 보여 준다.
- 택시는 자동차와 같은 경로·거리·시간을 쓰고 `mode`만 `taxi`다. 캐시 행은 키(`...:taxi`)가 달라 따로 저장한다. 같은 요청 묶음에 같은 구간의 car와 taxi가 함께 있으면 TMAP은 한 번만 부른다.
- **`fareKrw`(택시 요금)는 만들지 않는다.** TMAP 응답의 `taxiFare`·`totalFare`는 읽지 않는다. 대전 택시 요금 추정 방식이 설계에서 정해지지 않았다.
- `bus`는 계속 `unsupported_mode`다. 묶음에서는 그 항목만 실패로 빼고, 요청이 bus뿐이면 422다.
- **시간 초과 보호**: 캐시에 없는 경로를 TMAP에 차례로 물을 때 `timeout`이 한 번 나면, 같은 요청 묶음의 나머지 캐시 없는 걷기·자동차·택시 요청은 TMAP을 부르지 않고 `timeout` 실패로 뺀다. 이미 받은 경로와 캐시에 있는 경로는 그대로 돌려주고 `bus`는 그대로 `unsupported_mode`다. 시간 초과가 아닌 실패(키 없음·502)는 다음 요청을 막지 않는다. 시간 초과 때문에 더 기다리는 시간은 요청 제한 시간(8초) 한 번뿐이다. 하나도 못 받으면 첫 실패의 상태 코드(504 포함)를 쓴다. 이 보호는 한 번의 요청 묶음 안에서만 적용된다.
- 프론트 `SUPPORTED_LEG_MODES`와 AI의 걷기 전용 어댑터(`createLegsAdapter`)는 아직 walk만 묻는다. car·taxi를 묻게 바꾸는 것은 각 담당의 후속 작업이다.

## 캐시와 중복

- 키는 기존 `legKey(request)`를 그대로 사용한다. 방향·이동수단·지점 ID를 구분하며,
  좌표 키의 소수점 다섯 자리 반올림 규칙도 유지한다.
- 배치 안에서 같은 키는 첫 요청만 처리하고, 결과도 첫 등장 순서대로 하나씩 반환한다.
- 같은 서버 모듈에서 동시에 처리 중인 동일 키는 외부 호출과 저장을 공유한다.
  서로 다른 서버 프로세스 사이의 중복 호출 잠금은 구현하지 않았다.
- `leg_cache`는 DB에서 재사용한다. 경로선·거리·출처·날짜·수단별 필드(보행은 시간 없음, 자동차·택시는 소요 시간 있음)를 검사하며,
  이번 구현과 맞지 않는 이전 캐시는 삭제하지 않고 미스로 처리한다. 새 경로 성공 시 해당 키를 갱신한다.
- 기존 `fetched_at` 기준 **24시간 미만**인 캐시만 사용한다. 24시간 이상 또는 미래 시각인 행은
  삭제하지 않고 미스로 처리하며, 새 요청이 성공한 뒤 해당 키를 갱신한다. 실패하면 기존 행도 유지한다.
  이는 [TMAP 이용약관](https://tmapapi.tmapmobility.com/terms.html)의 저장 결과 사용 제한에 따른다.
  주기적 선제 갱신은 없으며, 출입 지점이나 경로 조건 변경 시의 조기 갱신 정책은 후속 과제다.

## TMAP 형식과 계단 검증 범위

구현 근거는 [공식 보행자 경로안내](https://tmap-skopenapi.readme.io/reference/보행자-경로안내)와
[공식 응답 예제](https://tmap-skopenapi.readme.io/reference/경로안내-샘플예제)다.
요청·응답은 `WGS84GEO`, 일반 탐색 옵션 `0`, 경로 순서 `index`를 지정한다.
출발점의 `totalDistance`와 연속된 `LineString`만 사용한다. 필수 출발·도착점,
도형·좌표·거리·선 연결을 검사하며 끊긴 선 사이에 새 직선을 추가하지 않는다.
보행 경로에서는 TMAP의 `totalTime`을 무시한다. 보행 시간은 엔진이 개인별 속도와 거리로 계산하므로
보행 경로에는 `durationMin`·별도 보행 시간을 넣지 않는다.

2026-10-31 이 작업공간에는 실제 OSM 수집 결과 파일이 없었다.
**계단 검증은 미완료이며 항상 `stairsStatus: "unknown"`이다.**
`stairsCount`와 `confirmed_none`은 생성하지 않는다. TMAP 시설 코드만으로 계단을 판정하지도 않는다.
신뢰 등급 B는 TMAP 경로·거리에 대한 기록이며 계단 확인이나 무장애 동선 보증이 아니다.
향후 실제 OSM 결과를 확보한 뒤 경로와 계단 교차 검사를 별도 구현한다.
노션 `daejeon_stairs.geojson` 비교는 원본이 없어 자료 부족으로 미검증이다.

## 검증 명령

```powershell
pnpm exec vitest run src/lib/geo
pnpm lint
pnpm test
pnpm test --maxWorkers=2
pnpm build
pnpm typecheck
```

테스트 응답은 `fixtures/tmap-walk.json`·`fixtures/tmap-car.json`에 직접 만든 목업이다(자동차는 공식 샘플의 필드 모양을 따랐다). 실제 TMAP 응답으로 주장하지 않는다.
테스트의 fetch는 모두 목업이며, 캐시는 새 `memory://` PGlite에 기존 마이그레이션을 적용해 검증한다.
인증 경계·중복·영속 캐시 재사용·재호출·잘못된 경로·오류·키 비노출·엔진 요청 호환을 검사한다.
기존 테스트와 공용 설정·시간 제한은 변경하지 않는다.

실제 호출 검증에는 TMAP 보행자 경로 권한이 있는 키, 호출 승인, 초기화된 로컬 DB,
로그인 세션, 확인할 출발·도착 좌표가 필요하다. 처음에는 캐시가 없는 walk 한 건만 호출하고,
실제 응답의 연결성과 출발·도착점 형식이 이 엄격한 파서와 맞는지도 확인해야 한다.

### 2026-10-31 검증 기록

| 검사 | 결과 |
| --- | --- |
| 경로 전용 테스트 | 2개 파일, 52개 통과 (24시간 경계·만료 후 갱신 검사 포함) |
| `pnpm lint` | 통과 |
| `pnpm typecheck` | 통과 |
| 기본 `pnpm test` 이번 재검사 | 39개 파일, 전체 599개 통과 |
| `pnpm test --maxWorkers=2` | 39개 파일, 전체 599개 통과 |
| `pnpm build` | 통과, `/api/legs` 동적 라우트 등록 |

이전 경로 구현 검증의 기본 실행은 38개 파일·592개 테스트 통과, 인증 파일 1개 초기화 실패로
7개 테스트가 미실행이었다. 기존 `src/lib/auth/signup-login.test.ts`의 `beforeAll`이
10초 제한을 넘겼고, 같은 시점의 `--maxWorkers=2` 실행은 599개 모두 통과했다.
이후 공유 준비 단계에서 다시 실행한 기본 테스트와 제한 병렬 테스트는 모두 통과했다.
장소 API 단계에서도 초기화 시간 초과가 관찰되었지만 확정 원인은 조사하지 않았다.
병렬 부하가 원인이라고, 또는 이번 변경과 무관하다고 단정하지 않는다.
제한 작업자 실행에서도 모든 검사는 유지했다. 기존 테스트·공용 설정·시간 제한은 수정하지 않았다.
OSM 계단 검증과 현장 출입 지점 확인은 수행하지 않았다.

### 승인된 실호출 1건과 별도 프로세스 캐시 검증

사용자가 Free 요금제·보행자 API 활성화·잔여 1건 이상을 확인한 후 실행했다.
추가 결제·상품 변경·계정 설정 변경은 하지 않았다. 개발 서버가 실행 중이지 않아 재시작은 필요 없었다.
로그인 HTTP 핸들러가 아닌 서버 함수 `getLegs()`와 실제 로컬 PGlite를 직접 검증했다.

| 항목 | 첫 요청 | 두 번째 동일 요청 |
| --- | --- | --- |
| 프로세스 | 새 Node, `--env-file=.env.local`로 키 로드 | 또 다른 새 Node, 환경 파일 미로드 |
| 외부 호출 | TMAP 1회, HTTP 200 | 모든 외부 호출 차단, 실제 호출 0회 |
| 조회 전 상태 | 유효한 캐시 없음 | 첫 결과가 디스크 캐시에 있음 |
| 결과 | 경로 계약·연결성 검사 후 저장 | 첫 결과와 동일함을 검사 |

요청은 한밭수목원 `hanbat`의 대표 좌표 `[127.387876, 36.365932]`에서
대전시립미술관 `art`의 대표 좌표 `[127.385754, 36.367080]`까지 `walk` 한 건이다.
외부 호출 상한 1회와 전송 전 마커를 두어 재시도·중복 실행을 방지했고, 첫 요청 후 DB를 닫았다.
두 번째 프로세스에서는 모든 fetch를 차단해 메모리 결과가 아닌 디스크 캐시 재사용을 확인했다.

- 캐시 키: `127.38788,36.36593>127.38575,36.36708:walk`
- 실제 응답: `distanceM: 318`, 경로 좌표 8개, 확인 날짜 `2026-10-31`, 신뢰 등급 B
- 계단: `stairsStatus: "unknown"`; `stairsCount`, `durationMin`, 택시 요금 없음
- 저장: `.pglite/places-api`의 `leg_cache`; 저장 후 24시간 미만에만 재사용
- TMAP 경로 시작: `[127.38761459688902, 36.36593384787013]`
- TMAP 경로 끝: `[127.38575361711189, 36.36722811110323]`

TMAP이 반환한 경로 종점은 요청 대표 좌표와 조금 다르다. 대표 좌표나 이 응답 종점을
검증된 입구로 취급하지 않으며, 요청 좌표까지 임의의 직선을 추가하지 않았다.
키 값·인증 헤더·외부 오류 원문은 출력하거나 검증 기록에 저장하지 않았다.
실제 응답은 테스트 목업으로 가장해 Git에 추가하지 않았고, 기존 데이터도 삭제하지 않았다.

### 로그인한 실제 HTTP 검증

2026-10-31 사용자 승인으로 `.pglite/places-api`에 검증 계정 1개를 생성한 뒤,
기존 `/api/auth/sign-in/email`로 로그인했다. 인증 코드·정책은 수정하지 않았다.
검증 개발 서버는 해당 로컬 DB를 사용했고, 프로세스의 TMAP 키를 빈 문자열로 설정했다.
추가로 TMAP URL의 fetch를 차단하고 호출 시도를 세었다. 환경 파일은 수정하지 않았고,
서버의 인증 응답·쿠키·비밀번호·헤더는 출력하거나 파일로 보관하지 않았다.

| 실제 HTTP 검사 | 상태·결과 |
| --- | --- |
| 세션 없는 `POST /api/legs` | 401 `unauthorized` |
| 로그인 후 기존 캐시 경로 요청 | 200, 318 m·좌표 8개·계단 `unknown` |
| 같은 세션에서 동일 경로 두 번째 요청 | 200, 첫 응답과 동일 |
| 범위를 벗어난 좌표 / 깨진 JSON | 각각 400 `invalid_request` |
| `car` 요청 (당시 walk 전용) | 422 `invalid_request` |
| `text/plain` 요청 | 415 `invalid_request` |
| 로그아웃 후 같은 세션으로 요청 | 401 `unauthorized` |
| TMAP 추가 호출 / 차단된 호출 시도 | 각각 0회 |

서버 종료 후 캐시의 `fetched_at`이 이전 값 `2026-10-30T23:53:49.145Z`와 같음을
확인했다. 새로 저장하거나 외부 재조회하지 않고 디스크 캐시를 읽었다.
검증 완료 후 로그아웃하고 개발 서버를 종료했다. 생성한 계정은 로컬에만 남겼으며
검증 스크립트와 결과 요약은 무시되는 `.next/`에서 실행해 커밋 대상에 넣지 않았다.
재현은 위의 로그인·API 명령과 목업 테스트로 가능하므로 별도 소스 스크립트는 추가하지 않았다.

## 공유와 PR 기준

2026-10-31 `git fetch origin` 이후 확인한 장소 API [PR #6](https://github.com/FIo-g/BoPok/pull/6)은
Draft·미병합 상태이고 원격 `geo/places-api`는 `a79393e`다.
따라서 이번 경로 API의 PR base는 **`geo/places-api`**다.
그 앞의 DB [PR #1](https://github.com/FIo-g/BoPok/pull/1)도 미병합으로,
의존 순서는 DB #1 → 장소 API #6 → 경로 API다. 병합되면 최신 원격 상태를 다시 확인해
base와 누적 변경을 검토한다. 이번 공유 준비에서는 병합·rebase·commit·push를 하지 않았다.

이번 커밋 후보는 `src/app/api/legs/route.ts`와 `src/lib/geo/`의 구현·목업 테스트·README,
총 10개 파일이다. 공용 계약·기존 테스트·인증·DB 스키마·설정 변경은 없다.
OSM 작업·대용량 결과·실제 TMAP 원본·`.env.local`·`.pglite/`·`.next/`·`node_modules/`는 제외한다.
프론트는 기존 장소 API의 실행·적재 명령을 사용하고 로그인 후 `api.legs.get(requests)`를 호출한다.

## 장소(POI) 검색 — `searchPoi`

`src/lib/geo/poi.ts`의 `searchPoi(name)`은 TMAP 장소(POI) 통합검색(`https://apis.openapi.sk.com/tmap/pois`)으로
이름에 맞는 **대전 안** 장소의 좌표 하나를 찾는다. AI(김태형)가 붙여넣은 일정의 이름이 장소 DB에 없을 때
좌표만 얻으려고 부른다. 위 경로 API(walk 전용 `getLegs`)와 별개이며 DB·캐시를 쓰지 않는다.
HTTP 라우트(`GET /api/places/search`)는 아직 만들지 않았고, AI는 서버 함수로 직접 부른다.

- 반환: `{ name, coord: [경도, 위도] }` 또는 `null`. 좌표는 TMAP이 준 중심 좌표(없으면 입구 좌표)이며
  입구로 검증된 값이 아니다. 시간·거리는 만들지 않는다.
- 키: 서버 환경 변수 `TMAP_APP_KEY`(기존 변수, 새로 추가한 것 없음). 요청 헤더로만 보내고 주소·로그·응답에 넣지 않는다.
  키가 없거나 이름이 비었거나 한 글자뿐(기호 제외)이면 외부 요청 없이 `null`이다.
- 결과 고르기: TMAP 결과를 순서대로 보며 아래를 모두 통과한 **첫 결과**를 쓴다. 통과한 결과가 없으면 `null`이다.
  - 결과 이름에 검색어가 들어 있다(공백·기호·대소문자 무시). 이름이 다른 가까운 곳의 좌표를 내놓지 않기 위해서다.
  - 주소(`upperAddrName`)가 있으면 `대전`으로 시작한다.
  - 좌표가 대전을 감싸는 사각형(경도 127.2~127.6, 위도 36.15~36.52) 안이다. 정확한 행정경계가 아닌 근사이며,
    사각형에 걸치는 세종·옥천 등은 주소 검사가 거른다.
- 실패: HTTP 오류·시간 초과(기본 8초, 재시도 없음)·잘못된 응답·네트워크 오류는 모두 `null`이고 예외를 던지지 않는다.
  로그에는 `[geo] POI 검색 실패 <종류>`(`missing_key`, `invalid_request`, `upstream`, `timeout`, `unknown`)만 남기고
  키·요청 헤더·외부 오류 본문은 남기지 않는다. 결과가 정상적으로 없을 때는 로그도 없다.
  호출하는 쪽은 `null`이면 그 이름을 '정보 없음' 장소로 두면 된다. 직선거리·가짜 좌표로 채우지 않는다.
- 검증: 테스트(`poi.test.ts`)는 가짜 fetch와 직접 만든 응답(`fixtures/tmap-poi.json`)만 쓰며 실제 TMAP은 부르지 않는다.
  요청 파라미터(`searchKeyword`, `searchType=all`, `searchtypCd=A`, `reqCoordType/resCoordType=WGS84GEO`, `count=10`)는
  SK open API 문서 기준이고 이번 작업에서 실제로 호출해 확인하지 않았다. 키를 넣은 배포 환경에서 실제 응답 모양을 한 번 확인한다.

```powershell
pnpm exec vitest run src/lib/geo/poi.test.ts
```
