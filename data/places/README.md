# 시범 장소 근거 자료

공식 사이트를 2026-10-31에 확인한 공개 기본 정보다. 외부 API 키 없이 확인했으며
웹 페이지나 지도 이미지를 복제하지 않고 이름·주소·연락처·대표 좌표만 정리했다.
한 장소 = 한 JSON 파일로 두어 기존 Zod 계약으로 검사하고 추가 파서 의존성 없이 적재한다.

| ID / 파일 | 장소 | 근거 페이지 | 대표 좌표 `[경도, 위도]` |
| --- | --- | --- | --- |
| `hanbat` / `hanbat.json` | 한밭수목원 | [대전광역시 한밭수목원 찾아오시는 길](https://www.daejeon.go.kr/gar/contentsHtmlView.do?menuSeq=8026) | `[127.387876, 36.365932]` |
| `art` / `art.json` | 대전시립미술관 | [대전시립미술관 찾아오시는 길](https://www.daejeon.go.kr/dma/dmaContentsHtmlView.do?menuSeq=6079) | `[127.385754, 36.367080]` |
| `leeungno` / `leeungno.json` | 이응노미술관 | [이응노미술관 찾아오시는 길](https://www.leeungnomuseum.or.kr/Menu.do?menuId=0402) | `[127.387000, 36.366790]` |

각 페이지의 지도 중심 `LatLng(위도, 경도)`를 계약의 `[경도, 위도]`로 변환했다.
세 곳 모두 대전광역시 서구 둔산대로에 있다. 지도상의 대표 위치만 확인했으므로 장소 전체
신뢰 등급은 보수적으로 B로 기록했다. 공식 연락처 확인이 내부 보행 경로 검증을 뜻하지 않는다.
한밭수목원 연락처는 공식 안내 `042-270-8452~3` 중 첫 번호, 대전시립미술관은 전시 안내 번호다.

스타일 태그는 공식 인증 정보가 아니라 시설 성격에 따른 서비스 분류다.
수목원은 `자연·산책`, `휴식·힐링`, 미술관은 `문화·역사`로 분류했다.
`indoor`는 주요 관람 공간의 성격이며 수목원은 야외, 미술관은 실내로 표시한다.
세 곳 모두 관람형이므로 `seated: false`다. 현장에서 앉을 곳이 없다는 뜻은 아니다.

`visitMin`은 생략한다. 한밭수목원만 장소 안 지점·구간이 있다(아래 "한밭수목원 장소 안 지점·구간" 절).
대전시립미술관·이응노미술관은 `nodes`, `segments`가 빈 배열이다. 이 두 곳의 내부 지점·구간·계단·경사·쉼터·화장실,
입구에서의 접근성과 소요 시간은 미조사이며 출입 가능 여부나 무장애 동선을 보증하지 않는다.
노션 `daejeon_stairs.geojson` 비교는 원본이 없어 **자료 부족으로 미검증**이다.
OSM 결과나 588개라는 수치에 맞춰 장소 파일을 생성·수정하지 않았다.

## 한밭수목원 장소 안 지점·구간 (동원 코스)

범위는 동원 한 바퀴(`hb-east`, "동원 한 바퀴(연못·장미원)") 하나다. 입구는 남쪽 출입구이고 같은 문으로 나온다.
지점 11개(주차장·정류장·입구·출구·화장실 각 1, 볼거리 4, 쉼터 2)와 구간 13개(접근 2, 관람 9, 우회 2)다.
관람 구간 중 장미원 다녀오기(`hb-t5`, `hb-t6`)는 선택 구간이다. 우회 구간 `hb-t1d`, `hb-t9d`는 계단이 있는 구간의 계단 없는 길이다.
관람 구간 합계는 선택 구간을 뺀 약 858m이고, 선택 구간까지 넣으면 약 954m다(OSM 보행로 최단 경로 근사치).

| 근거 | 지점 | 정확도 |
| --- | --- | --- |
| OSM 보행로·시설을 직접 사용 | 1주차장, 정류장, 입구·출구, 화장실, 수생식물원 정자, 장미원, 화밀원 쪽 쉼터 | OSM 좌표 그대로(주차장·정류장은 OSM 면·점의 중심) |
| 공식 종합안내도 대조 후 가장 가까운 OSM 보행로 점에 붙임 | 수국원, 허브원, 식이식물원 | 안내도 대조 오차 약 12m(식이식물원은 최대 20m) |

**만든 방법**
1. `data/places/inside/hanbat.design.json`: 지점 위치·번호·근거(`basis`)·구간 순서·안내도 대조 기록. 안내도 그림은 저작물이라 저장소에 넣지 않았다.
2. `data/places/osm/hanbat-east-osm-20261104.json`: Overpass(2026-11-04)에서 보행로·계단·동원 경계·편의시설만 잘라 둔 추출본(ODbL).
3. `scripts/data/build-place-inside.mjs`: 보행 그래프를 만들고, 지점마다 가장 가까운 보행로 위 점(40m 이내)에 붙인 뒤, 구간마다 최단 경로(다익스트라)로 좌표열과 거리를 구한다. 지점 좌표는 설계 값 그대로 두고 경로만 붙인다. 계단이 있는 관람 구간은 계단을 뺀 길로 우회 구간을 더한다. 결과는 장소 계약(`PlaceDetailSchema`)으로 검사한 뒤 `data/places/hanbat.json`에만 쓴다. 같은 입력이면 같은 결과가 나온다.
4. 코스(`courses`)는 파일에 있지만 저장할 표가 없어 DB에는 넣지 않는다.

**정확도와 한계** (추정치이며 현장 확인 전 단정하지 않는다)
- 안내도 대조 지점은 수십 m 안에서 어긋날 수 있다. 검증 점 8개의 오차는 중앙값 약 11m, 최대 약 19m였고, 동원 남쪽 바깥쪽은 보정 점이 없어 약 25m까지 본다. 정원 안에서 대표로 볼 자리는 현장에서 바뀔 수 있다.
- 거리는 OSM 보행로 위 최단 경로의 근사치다. 화면은 범위("약 15~20분")로 보여야 한다.
- 경사·노면·계단 여부는 현장에서 확인하지 않았다. 경로에 OSM `highway=steps` 길이 있는 구간만 `stairsStatus: "present"`이고, 나머지는 `unknown`(계단 기록 없음)이다. `confirmed_none`은 쓰지 않았다. `slope`는 OSM `incline` 태그가 없어 모두 `false`이며 미확인이다.
- 우회 구간 `hb-t1d`, `hb-t9d`는 계단 없는 길로 찾은 경로일 뿐 실제 통행 가능 여부는 확인하지 않았다.
- 정자·화밀원 쪽 쉼터의 앉을 자리, 화장실 `node/1342141459`의 장애인 화장실 여부, 정류장과 보행로 연결, 개장 시간·휴무·공사 구간은 미확인이다.
- 신뢰 등급은 설계 메모가 안내도 근사 지점을 C로 권했으나, 이번 적재는 모든 구간을 B(지도 측정 + 안내도 대조)로 기록했다.

**출처 표기**: 구간의 `source`에 "OpenStreetMap 보행로 최단 경로(© OpenStreetMap contributors) · 지점: 한밭수목원 종합안내도(대전광역시) 대조", 확인 날짜 2026-11-04를 넣었다. OSM 데이터는 ODbL 1.0이다.

**다시 만들기와 적재**
```powershell
pnpm data:hanbat-inside
# 공용 DB를 읽기만 확인 (넣을 개수와 지금 상태만 출력)
node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id hanbat
# 넣기: 총괄이 main 머지 후에만 실행한다. 장소가 있고 지점·구간이 0개일 때만 넣는다
node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id hanbat --apply
```
이 적재 스크립트는 공용 Neon(`DATABASE_URL`)만 쓴다. 로컬 PGlite에는 아직 넣지 않는다.

## 적재

프로젝트 루트에서 개발 서버와 DB 도구를 종료하고 실행한다.

```powershell
node --conditions=react-server scripts/data/load-places.mjs --ids hanbat
node --conditions=react-server scripts/data/load-places.mjs
```

첫 명령은 한 장소로 연결을 확인할 때, 두 번째는 전체 3곳을 넣을 때 사용한다.
상세 실행·프론트 연결은 `src/lib/places/README.md`와 `scripts/data/README.md`에 있다.
출처·날짜·등급·좌표를 검사하며, 같은 데이터는 건너뛴다. 기존 ID의 내용이 다르면
덮어쓰거나 삭제하지 않고 실패한다. 다른 장소나 기존 내부 지점·구간은 수정하지 않는다.

## 다른 장소에 장소 안 데이터 만들기 (범용)

한밭수목원 말고 공유 DB에 있는 다른 장소(예: `tourapi-12-125994`)도 같은 방법으로 만든다.
장소 안 지점·구간은 손으로 적은 **설계 파일**과 **OSM 보행로 추출본**으로 만들고, 결과는 DB에 넣기 전에 파일로 검사한다.

1. 설계 파일 `data/places/inside/<id>.design.json`을 만든다. 한밭수목원 설계 파일(`hanbat.design.json`)을 본뜬다.
   - `osmFile`: OSM 추출본 경로 (없으면 `data/places/osm/<id>-osm-*.json` 하나를 찾는다)
   - `source`(출처 문구), `checkedAt`(확인 날짜): 둘 다 필수. 결과의 모든 구간·코스에 붙는다.
   - `course`: `{ id, name }`. 관람 구간(`role: "tour"`)이 있으면 필수.
   - `boundaryWay`(선택): 관람 지점이 이 way 안이나 30m 안에 있는지 검사한다. 없으면 검사하지 않는다.
   - `nodes`: `id`, `kind`, `name`, `restType`, `lng`, `lat`, 선택 `guideNo`(안내도 번호), `floor`(층, 1=1층, -1=지하 1층).
   - `confidence`(선택, A/B/C, 기본 B): 설계 전체 신뢰 등급. 지점에 `confidence`를 주면 그 지점에 닿는 구간은 둘 중 낮은 등급을 쓴다.
   - `snapLimitM`(선택, 0보다 크고 100 이하)과 `snapNote`(짝으로 필수): 보행로에서 기본 40m를 넘게 떨어진 지점의 붙임 한도와 그 이유 한 줄. 한도를 늘린 지점은 빌드 출력의 `snapLimitChanged`에 남는다.
   - `extraWays`(선택): 추출본에 선이 없는 길을 그래프에 더한다. `{ id, note, coords }`. `note`(어떤 지형지물에서 좌표를 땄는지)는 필수이고, 양 끝 점은 보행망 위 10m 안이어야 한다. 계단·경사는 unknown으로 둔다.
   - `segments`: `id`, `from`, `to`, `order`, `optional`, `role`(`access` 또는 `tour`).
2. 지점·구간을 만든다. 시범 장소 파일(`data/places/<id>.json`)이 있으면 그 파일을 고치고, 없으면 `data/places/inside/<id>.json`을 쓴다.
   ```bash
   node scripts/data/build-place-inside.mjs --id tourapi-12-125994
   ```
   결과는 장소 계약(`PlaceDetailSchema` 또는 장소 안 전용 계약)으로 검사한 뒤에만 쓴다. DB는 건드리지 않는다.
3. 공용 DB를 읽기만 확인한다(넣을 개수·지금 상태·칸 유무만 출력).
   ```bash
   node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id tourapi-12-125994
   ```
4. 빈 장소에 넣는다 (지점·구간이 0개일 때만, 총괄 확인 후): `... --id <id> --apply`
5. 이미 넣은 장소의 안내도 번호·층만 채운다. DB 값이 null인 칸만 채우고, 다른 칸은 건드리지 않으며, 값이 다르면 바꾸지 않고 `conflicts`로 알린다.
   ```bash
   node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id <id> --sync-labels          # dry-run (읽기만)
   node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id <id> --sync-labels --apply  # 총괄 확인 후
   ```

**주의**
- 마이그레이션 `0007_place-node-guide-floor`(`place_nodes`의 `guide_no`·`floor` 칸)가 공용 DB에 적용되기 전에는 `--apply`와 `--sync-labels --apply`가 멈추고, dry-run은 "마이그레이션 먼저"라고 안내한다. 마이그레이션은 main에 머지된 뒤 총괄이 적용한다.
- 공용 DB에 쓰는 명령은 총괄 확인 후에만 실행한다. `DATABASE_URL`이 `.neon.tech` 주소가 아니면 스크립트가 멈춘다.
- 신뢰 등급·확인 날짜·출처는 설계 파일의 값을 그대로 쓴다. 현장 확인 없이 `confirmed_none`(계단 없음)으로 바꾸지 않는다.

## 시연 장소 장소 안 지점·구간 (2026-11-04~05, 세 곳)

영상 시연용 여행 일정에 넣을 장소 세 곳의 장소 안 데이터 결과다(빌드 2026-11-05). 설계 파일(`data/places/inside/<id>.design.json`)과 빌드 결과 파일(`data/places/inside/<id>.json`)은 세 곳 모두 있다. 국립중앙과학관·유림공원은 처음 빌드가 실패한 원인(붙임 거리, 끊긴 보행망)을 설계의 붙임 한도(`snapLimitM`)와 `extraWays`로 풀었다.

| ID | 장소 | 상태 | 지점 | 구간 | 관람 합계 |
| --- | --- | --- | --- | --- | --- |
| `tourapi-12-2738037` | 대전엑스포시민광장 | 빌드 성공 (`inside/tourapi-12-2738037.json`) | 9 | 9 (접근 2, 관람 7; 선택 2) | 주 경로 1272m, 선택 포함 1586m |
| `tourapi-14-129785` | 국립중앙과학관 | 빌드 성공 (`inside/tourapi-14-129785.json`) | 9 | 9 (접근 2, 관람 7; 선택 2) | 주 경로 1784m, 선택 포함 2082m (지침 초과) |
| `tourapi-12-2674960` | 유림공원 | 빌드 성공 (`inside/tourapi-12-2674960.json`) | 9 | 10 (접근 2, 관람 8; 선택 2) | 주 경로 829m, 선택 포함 911m |

**1. 대전엑스포시민광장 (`tourapi-12-2738037`, 코스 `ep-axis`, 시민광장 중앙축·곤충생태관 한 바퀴)**
- 지점: 주차장(1주차장) 1, 정류장(한밭수목원) 1, 입구(남쪽 2·3게이트 사이) 1, 출구 1, 화장실 1, 볼거리 2(곤충생태관, 북쪽 원형광장), 쉼터 2(원형광장 정자, 남쪽 입구 쉼터). 안내도 번호 없음(`guideNo` 없음).
- 근거: OSM 요소 좌표 그대로 사용(OpenStreetMap, ODbL). 안내도(대전관광공사 조감도, 확인 2026-11-04)는 위치 확인용으로만 맞췄다. 화장실과 원형광장 정자는 안내도와 약 6~7m 일치했다.
- 계산: 지점을 보행로에 붙인 거리는 최대 18.9m(화장실)다. 관람 구간 주 경로는 1272m, 곤충생태관 다녀오기(선택 2구간) 포함 1586m다. 계단 `present`는 0개이고 전 구간 `unknown`(계단 기록 없음)이다.
- 한계: 경사·계단은 현장 확인 못 함. 쉼터 벤치 수·그늘, 화장실 장애인 시설(OSM wheelchair=yes), 정류장과 보행로 연결, 개장 시간·행사 출입 제한은 확인 못 함. 신뢰 등급은 모든 구간 B로 적재한다.
- 엔진 테스트: `src/lib/engine/ep-axis-data.test.ts` (unknown 없음, 관람 합계 300~2000m).
- 공용 DB 읽기 확인(dry-run, `--apply` 없음): `placeInDb: true`, `nodesInDb: 0`, `segmentsInDb: 0`, `labelColumns: missing_run_migration_0007`(공용 DB에 마이그레이션 0007이 아직 없음), `wouldFill: true`. 쓰지 않았다.

**2. 국립중앙과학관 (`tourapi-14-129785`, 코스 `sc-yard`, 야외 한 바퀴: 우주과학공원·역사의 광장)**
- 지점 9: 주차장 1, 정류장 1, 정문(입구) 1, 화장실 1, 볼거리 3(우주과학공원 3, 야외음악당 4, 역사의 광장 2), 쉼터 1(원두막 5), 출구 1. 안내도 번호(`guideNo`)는 2·3·4·5다.
- 구간 9: 접근 2(주차장→정문, 정류장→정문), 관람 7(주 5, 선택 2: 야외음악당 다녀오기 t3·t4).
- 관람 길이: 주 경로 1784m, 선택 포함 2082m. 설계 메모의 지침(0.5~1.5km)을 넘는다(아래 계산 메모). 계단은 `present` 0개, 전 구간 `unknown`(계단 기록 없음).
- 붙임 거리: 최대 72.6m(역사의 광장 `sc-hist`). 한도를 바꾼 지점은 이 하나다. `snapLimitM` 80(기본 40), 이유: 역사의 광장 면이 지도에 없고 광장 안을 지나는 보행로도 없어, 가장 가까운 보행로에서 광장 대표점까지 직선으로 잇는다. 나머지 지점은 28.8m 이내(우주과학공원 3이 28.8m).
- `extraWays` 3개(각 `note`에 땐 지형지물을 적었다):
  - `sc-stop-link` 4m: 정류장 앞에서 끊긴 두 보행로 끝을 잇는다.
  - `sc-park-link` 9m: 우주과학공원 안 보행로 끝과 바깥 보행로 끝을 잇는다. 공원 안 3·4·5가 이 보행로에 붙는다.
  - `sc-bridge` 25m: 정류장 쪽 보행로 끝에서 다리 서쪽 끝 중앙(정문 자리)까지. 다리는 OpenFreeMap 타일의 bridge 면이며 추출본에는 면이 없어 타일 원본 좌표를 썼다. 다리 가운데 선은 추출본 path와 3m 안에서 겹쳐 따로 그리지 않았다.
- 신뢰 등급: 안내도로 맞춘 지점 `sc-wc`(화장실), `sc-music`(야외음악당), `sc-rest`(원두막 쉼터)는 설계에서 `confidence: "C"`다. 이 지점에 닿는 구간 t1~t6은 C, 접근 a1·a2와 t7은 B다. 코스는 B.
- 계산 메모(추정치, 현장 확인 전): 공원 안 보행로가 추출본에서 바깥 보행로와 끊겨 있어 길이가 길어졌다. 쉼터→역사의 광장 t6 818m(설계 추정 약 360m), 화장실→우주과학공원 t2 547m, 정문→화장실 t1 194m, 주차장→정문 a1 427m(직선 약 177m). 우회 경로는 추출본 보행망을 따라 계산한 값이며, 길을 더 그리려면 현장이나 다른 지도 확인이 필요하다(선을 임의로 긋지 않았다).
- 엔진 테스트: `src/lib/engine/sc-yard-data.test.ts` (unknown 없음, 관람 합계 300~2500m, guideNo가 있는 볼거리 있음).
- 공용 DB 읽기 확인(dry-run, `--apply` 없음): `placeInDb: true`, `nodesInDb: 0`, `segmentsInDb: 0`, `labelColumns: ready`, `wouldFill: true`. 쓰지 않았다.

**3. 유림공원 (`tourapi-12-2674960`, 코스 `yr-west`, 서쪽 분수·유림정 한 바퀴)**
- 지점 9: 주차장(궁동공영주차장) 1, 정류장 1, 정문(서쪽 진입광장) 1, 볼거리 3(분수 5, 산수유길 9, 중앙광장 바닥분수 13), 쉼터 1(유림정 4), 화장실 1, 출구 1.
- 구간 10: 접근 2(주차장→정문, 정류장→정문), 관람 8(주 6, 선택 2: 바닥분수 다녀오기 t5·t6).
- 관람 길이: 주 경로 829m, 선택 포함 911m. 계단은 `present` 0개, 전 구간 `unknown`.
- 붙임 거리: 최대 60.5m(주차장 `yr-p`). 설계에 `snapLimitM` 70, `snapNote` "주차장 면의 중심에서 가장 가까운 보행로까지 약 60m이고, 주차장 안에는 보행로가 그려져 있지 않아 직선으로 잇는다(모서리 기준 약 27m)"를 적었다. 나머지 지점은 4.8m 이내.
- `extraWays` 없음.
- 신뢰 등급: 설계 전체 `confidence: "C"`. 2022년 블로그 안내판 사진으로 맞춘 지점이 있고 안내판이 현행인지 확인하지 못해, 구간 10개와 코스를 모두 C로 적재한다.
- 계산 메모: 주차장→정문 a1 411m(직선 약 294m). 주차장 중심에서 보행로까지 60m는 직선이다.
- 엔진 테스트: `src/lib/engine/yr-west-data.test.ts` (unknown 없음, 관람 합계 300~2000m, guideNo가 있는 볼거리 있음).
- 공용 DB 읽기 확인(dry-run): `placeInDb: true`, `nodesInDb: 0`, `segmentsInDb: 0`, `labelColumns: ready`, `wouldFill: true`. 쓰지 않았다.

**출처와 저작권**
- OSM 추출본: `data/places/osm/tourapi-12-2738037-osm-20261104.json`, `data/places/osm/tourapi-14-129785-osm-20261104.json`, `data/places/osm/tourapi-12-2674960-osm-20261104.json` (각 파일의 `attribution`에 ODbL 1.0 표기). 세 파일 모두 200KB 이하다. 국립중앙과학관 추출본은 OpenFreeMap 타일(OSM 기반)에서 만들었고 OSM 요소 번호가 없다.
- 안내도 그림(국립중앙과학관 PNG, 대전관광공사 조감도, 유성구 블로그 사진)은 저작물이라 저장소에 넣지 않았다. 설계 파일의 `guideSource`에 원본 주소와 확인 날짜만 적었다.
- 설계 파일에 적힌 로컬 계산 파일 경로는 `(로컬 계산 파일, 저장소에 없음)`으로 바꿨다.

**다시 만들기**
```bash
node scripts/data/build-place-inside.mjs --id tourapi-12-2738037
node scripts/data/build-place-inside.mjs --id tourapi-14-129785
node scripts/data/build-place-inside.mjs --id tourapi-12-2674960
node --conditions=react-server --env-file-if-exists=.env.local scripts/data/load-place-inside.mjs --id tourapi-14-129785          # dry-run (읽기만)
```
적재(`--apply`)는 main에 마이그레이션 0007이 머지되고 총괄이 확인한 뒤에만 한다.
