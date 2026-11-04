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
