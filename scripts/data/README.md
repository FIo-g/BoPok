# 장소 데이터 작업

담당: 이동주. 이번 브랜치는 장소 API와 시범 장소 적재를 다룬다.
OSM 수집 구현은 별도 `geo/fetch-osm` 브랜치에 보존한다. TourAPI·TMAP은 후속 단계다.

## 장소 API용 시범 데이터 적재

개발 서버와 DB 도구를 종료한 뒤 프로젝트 루트에서 실행한다.

```powershell
# 한 장소로 DB→API를 먼저 확인할 때
node --conditions=react-server scripts/data/load-places.mjs --ids hanbat
# 시범 3곳 전체 적재 / 재실행해도 동일한 데이터는 보존
node --conditions=react-server scripts/data/load-places.mjs
```

`load-places.mjs`는 기존 Drizzle 마이그레이션을 적용하고 `data/places/*.json`을
Zod로 검사해 넣는다. `.env.local`을 읽지 않고 `DATABASE_URL`을 비우며 저장 경로는
**`.pglite/places-api`로 고정**한다. 기존 `.pglite` 실험 DB를 옮기거나 초기화하지 않는다.
기존 장소 ID의 내용이 다르면 실패하며, 기존 행을 갱신·삭제하지 않는다.
지점·구간·계단·방문 시간은 만들지 않는다. 기록 없는 계단을 `confirmed_none`으로 바꾸지 않는다.

별도 의존성 추가 없이 설치된 `drizzle-kit`의 TypeScript 로더를 사용한다.
`--conditions=react-server`는 서버 전용 모듈을 이 로컬 CLI에서 읽기 위해 필요하다.
스크립트는 개발 서버 잠금 파일이 있으면 중단한다. 같은 PGlite를 여러 프로그램에서 열지 않는다.

```powershell
$env:DATABASE_URL = ''
$env:PGLITE_DIR = '.pglite/places-api'
$env:NEXT_PUBLIC_USE_MOCKS = '0'
pnpm dev
pnpm exec vitest run src/lib/places/places.test.ts
```

장소 ID·근거: `data/places/README.md`. API 계약·요청 예시·미조사 정보:
`src/lib/places/README.md`. 아래 0단계 명령은 기본 `.pglite`용이므로
장소 API 시범 실행에는 위 적재 명령을 사용한다.

## 장소 DB 구조 (0단계)

- 스키마: `src/lib/db/schema/places.ts`
- 테이블: `places`, `place_nodes`, `place_segments`, `leg_cache`
- 마이그레이션: `drizzle/0001_place-schema.sql`, `drizzle/meta/`
- 검증: `src/lib/db/schema/places.test.ts` (가상 데이터와 메모리 PGlite만 사용)

프로젝트 루트에서 실행한다. Windows PowerShell에서 `pnpm.ps1` 실행이 막히면 `pnpm.cmd`를 쓴다.

```powershell
# 기본 설정과 같은 통합 스키마를 쓰되 .env.local·DATABASE_URL을 읽지 않는 로컬 전용 설정
pnpm exec drizzle-kit generate --config=scripts/data/drizzle-local.config.ts --name=place-schema
# .pglite를 쓰는 개발 서버와 DB 도구를 먼저 종료한 뒤 적용
pnpm exec drizzle-kit migrate --config=scripts/data/drizzle-local.config.ts
pnpm exec vitest run src/lib/db/schema/places.test.ts
```

전용 설정은 `.env.local`을 읽지 않으며, DB 경로를 프로젝트의 `.pglite`로 고정한다.

`schema/index.ts`에 장소 스키마를 등록했으며, 기존 `getDb()`와 기본 Drizzle 설정,
로컬 전용 설정이 모두 이 통합 스키마를 사용한다. 같은 `drizzle/` 이력에 서로 다른
테이블 목록으로 생성하면 다른 담당 테이블이 삭제 대상으로 판단될 수 있으므로,
다른 스키마가 추가되어도 전용 설정의 기준을 `places.ts`로 되돌리지 않는다.

기본 `drizzle.config.ts`는 `.env.local`을 자동으로 읽는다. 비밀 파일을 열지 않고
로컬에서 검증할 때는 위 명령을 사용한다. `getDb()`로 같은 DB를 확인할 때는
`DATABASE_URL`을 비우고 `PGLITE_DIR`을 `.pglite`로 지정한다.

적용 전에는 생성된 SQL 전체를 검토한다. 삭제·자료 손실 가능성이 있으면 적용하지 않는다.
등록만 바꿔 테이블 정의가 같다면 새 마이그레이션은 생기지 않는 것이 정상이다.
이미 적용된 `0000`·`0001` SQL과 메타데이터는 다시 작성하지 않는다.

## 저장 규칙

- 지점·구간은 `(place_id, id)`를 기본 키로 사용한다. `entrance` 같은 ID를 장소별로 쓸 수 있다.
- 구간의 양 끝 지점과 우회 대상은 같은 장소에 있어야 한다. 우회 대상 구간을 먼저 적재한다.
- `path`는 계약과 같은 `[경도, 위도][]` JSON 배열이다. 장소 구간은 최소 두 점을 저장한다.
- 좌표는 `lng`, `lat`로 나눠 저장한다. 조회 시 `coord: [lng, lat]`로 구성한다.
- 선택 필드의 DB `null`은 계약에서 허용하는 `undefined`로 변환해야 한다. `restType`은 계약도 `null`을 허용한다.
- 장소·구간·캐시는 출처, 확인 날짜, 신뢰 등급을 필수로 저장한다. 지점은 현 계약대로 장소 소속 정보만 저장한다.
- 계단 상태는 명시적으로 입력한다. 기록이 없다는 이유로 `confirmed_none`을 만들지 않는다.
- 캐시 기본 키는 기존 `legKey(request)`의 결과다. 이동 방향과 수단을 구분하며 별도의 키 생성 규칙을 만들지 않는다.
- 걷는 시간·판정은 저장하지 않는다. `duration_min`은 탈것 이동 시간, `fare_krw`는 택시 추정 요금을 담을 수 있도록 준비했다.
- 장소를 삭제하면 소속 지점·구간도 삭제된다. 외부 호출과 실제 관광지 데이터는 포함하지 않는다.
