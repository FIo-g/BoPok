# 역할: 장소 데이터 + 장소 사이 경로 — 이동주 (P5, P4 경로)

브랜치 접두어 `geo/` · 설계 문서 8장(장소 데이터), 7.3.1(장소 안 경로와 장소 사이 이동), 노션 '계단 데이터셋'

## 한 줄

대전 유명 관광지의 지점·구간·계단·쉼터 데이터를 만들어 DB에 넣고, 일정 순서에 따라 필요한 장소 사이 경로를 TMAP으로 가져와 계단을 검사해 돌려준다. **시범 장소 몇 곳을 먼저** 끝까지 넣어서 다른 역할이 진짜 데이터로 일할 수 있게 한다.

## 맡는 폴더

`src/app/api/{places,legs}/**`, `src/lib/places`, `src/lib/geo`, `src/lib/db/schema/places.ts`, `scripts/data`, `data/`

## 설계 가이드 — 데이터 작업 (`scripts/data`, `data/`)

```
data/
  raw/            외부에서 받은 원본 (용량 크면 .gitignore, 받는 스크립트는 커밋)
  osm/            Overpass로 받은 대전 계단·벤치·쉼터·화장실 GeoJSON
  places/         장소별 사람이 입력한 파일 (한 장소 = 한 파일, 예: hanbat-arboretum.yaml)
scripts/data/
  fetch-tourapi.ts    TourAPI 대전 관광지 목록 → data/raw (후보 고르기용)
  fetch-osm.ts        Overpass: highway=steps, amenity=bench|shelter|toilets, leisure=picnic_table (대전 경계 안)
  build-segments.ts   장소 파일 → TMAP 보행 경로 → 계단 겹침 → 구간
  load-db.ts          장소·지점·구간을 DB에 upsert
```

### 장소 파일 (`data/places/<slug>.yaml`) — 사람이 채우는 것

- 기본: 이름, 분류, 스타일 태그, 좌표, 주소·전화·홈페이지(TourAPI에서 채움), `visitMin`(홈페이지 기준 머무는 시간), `seated`, `indoor`, 출처·확인 날짜·신뢰 등급
- 지점: 주차장·정류장(이동수단별 출발 지점), 입구, 볼거리(관람 순서), 출구, 쉼터(실내/야외), 화장실 — 홈페이지 안내도·OSM·지도에서 좌표를 찍는다
- 관람 경로: 지점 순서, 선택 구간(`optional`), 계단 구간의 우회로
- 계단 직접 확인 값(덮어쓰기): 구간마다 `present`(칸 수) 또는 `confirmed_none` + 확인 방법(안내도·로드뷰·현장)과 날짜. 이 값이 OSM 결과보다 우선

### `build-segments.ts`

1. 장소 파일의 관람 경로를 구간(지점 → 지점)으로 쪼갠다
2. 구간마다 TMAP 보행자 경로 → `distanceM`, `path`
3. 경로를 몇 m 폭으로 넓혀 OSM 계단 선과 겹치는지 검사 → 겹치면 `present`(`step_count` 있으면 칸 수), 아니면 `unknown`
4. 장소 파일의 직접 확인 값으로 덮어쓰기
5. 출처·확인 날짜·신뢰 등급 붙이기 (TMAP 측정 = B, 공식 안내·현장 = A)

TMAP의 '계단 제외' 경로 옵션은 노션 테스트에서 믿을 수 없었으므로 쓰지 않는다. 같은 입력이면 같은 결과가 나오게 하고, TMAP 응답은 `data/raw`에 저장해 다시 쓴다(호출 한도).

### 장소 목록 정하기

TourAPI 대전 관광지 → 유명한 곳을 골라 팀에 확인받는다. **시범 3~5곳**(한밭수목원, 국립중앙과학관, 엑스포과학공원·한빛탑, 대전시립미술관, 이응노미술관 등 시안에 나온 곳)을 먼저 끝까지 넣고, 그다음 목록을 넓힌다. TourAPI에 무장애 여행 정보가 있으면 쓸 수 있는지 확인한다.

## 설계 가이드 — 서버 (`src/lib/places`, `src/lib/geo`, API)

| 함수·API | 내용 |
| --- | --- |
| `lib/places`: `listPlaces(filters)`, `getPlaceDetails(ids)` | 장소 요약 목록, 지점·구간 포함 상세 |
| `lib/places/search.ts`: `searchCandidates({ styles, budget, transport, avoidStairs, limit })` | **구현됨.** AI(김태형)용 후보 추리기. 스타일 맞는 곳을 앞에, 계단 피하기면 계단 `present`인 장소를 뒤로(`unknown`은 그대로). 예산·이동수단은 장소 데이터에 칸이 생기면 쓴다 |
| `lib/places/search.ts`: `matchPlaceByName(name)` | **구현됨.** 붙여넣은 일정의 이름 → 장소. 공백·기호 무시, 후보가 둘 이상이거나 "근처·앞·주변·옆"이 붙으면 `null`. 별칭은 DB에 칸이 생기면 |
| `lib/geo/tmap.ts` | 보행자 경로(구현됨), (필요하면) 자동차 경로. 키는 서버 환경 변수 |
| `lib/geo/poi.ts`: `searchPoi(name)` | **구현됨.** TMAP 장소(POI) 통합검색 → `{ name, coord }`. 대전 밖 결과는 버리고, 키가 없거나 실패하면 `null`. 설명은 `src/lib/geo/README.md` 마지막 절 |
| `lib/geo/stairs.ts` | 경로 ↔ OSM 계단 겹침 검사 (`build-segments`와 `getLegs`가 같이 씀). OSM 계단 데이터는 서버에서 파일로 읽어 메모리에 둔다 |
| `lib/geo/legs.ts`: `getLegs(requests: LegRequest[])` | 장소 사이 경로. `leg_cache` 먼저 보고 없으면 TMAP → 계단 검사 → 저장. 걷기는 보행자 경로, 탈것은 시간·거리 추정(택시는 대전 택시 요금으로 `fareKrw` 추정, 출처 주석) |
| `GET /api/places?styles=&q=` | 장소 목록 (직접 고치기 화면) |
| `GET /api/places/:id` | 장소 상세 |
| `POST /api/places/details` | 여러 장소 상세 한 번에 `{ ids }` |
| `POST /api/legs` | `{ requests: LegRequest[] }` → `Leg[]` (프론트가 즉시 재판정에 씀) |
| `GET /api/places/search?q=` | DB에 없는 장소 좌표 찾기 (TMAP POI). **아직 없음** — AI는 `searchPoi`를 서버 함수로 직접 부른다 |

`legKey(req)`는 contracts에 두어 프론트·엔진·서버가 같은 키를 쓰게 한다.

## 받는 것 / 주는 것

- 받는 것: `Stop`·`LegRequest` 타입, `requiredLegs`(김태형), DB 연결(김경선)
- 주는 것: `PlaceDetail` 데이터와 `lib/places` 함수(김태형·김경선), `getLegs`·`/api/legs`(김경선·오하연), POI 검색(김태형)

## 작업 순서

| 단계 | 할 일 | 완료 기준 |
| --- | --- | --- |
| 0 | contracts 중 `place.ts`·`leg.ts` 확인 (초안은 main에 있음), `schema/places.ts`(places, place_nodes, place_segments, leg_cache) | 로컬 PGlite에 마이그레이션 적용, PR은 팀원 한 명 승인 |
| 1 | `fetch-osm.ts`(계단·벤치·쉼터·화장실), `fetch-tourapi.ts` | 대전 데이터가 `data/`에 생김. 노션 `daejeon_stairs.geojson`과 개수 비교 |
| 2 | `lib/geo/tmap.ts`, `stairs.ts` + 테스트(저장한 TMAP 응답으로) | 한 구간의 거리·계단 상태가 나옴 |
| 3 | 시범 3~5곳 장소 파일 + `build-segments` + `load-db` | DB에 시범 장소 지점·구간이 들어감 |
| 4 | `lib/places` 함수, `/api/places*` | 프론트가 진짜 장소로 지도를 그림 |
| 5 | `getLegs` + `leg_cache` + `/api/legs`, 택시 추정 | 일정 순서를 바꾸면 새 경로가 옴 |
| 6 | 장소 목록 넓히기 (팀 확인), 계단 직접 확인 채우기 | 유명 관광지 대부분, 장소 안 구간에 `unknown`이 거의 없음 |
| 7 | `searchCandidates`, `matchPlaceByName`, POI 검색 | AI가 후보·이름 매칭에 씀 |

## 주의

- OSM에 계단이 없다고 "계단 없음"이 아니다. 사람이 확인하지 않았으면 `unknown`.
- OSM 데이터를 쓰면 화면에 저작권 표기(© OpenStreetMap contributors)가 필요하다. 프론트에 알린다.
- 데이터를 넣을 때마다 출처·확인 날짜·신뢰 등급이 빠지지 않았는지 `load-db`에서 검사해 빠지면 실패시킨다.
