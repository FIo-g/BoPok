# 지도 데이터와 스크립트 (프론트 — 오하연)

> 이 폴더는 시안(Bopok)의 지도 데이터 전처리 스크립트를 옮긴 것입니다. 지도 화면 코드는 `src/components/map/`, 결과 파일은 `public/tiles`, `public/data`, `public/map` 에 있습니다.
> 명령: `pnpm map:buildings`(건물·그림자·나무), `pnpm map:trees`, `pnpm map:boundary`, `pnpm map:style`, `pnpm map:assets`(MapLibre 워커 복사 — `pnpm dev`·`pnpm build` 가 자동으로 실행). 원본 SHP 는 레포에 없습니다. 타일을 다시 만들 일이 있을 때만 필요합니다.
> 지도를 보여 줄 때는 © OpenStreetMap contributors, OpenFreeMap 표기를 유지합니다.

# 3D 건물 데이터 (대전 전체)

지도 화면에서 건물을 3D로 세우기 위한 전처리 결과물입니다. 결과는 벡터 타일 `public/tiles/buildings/{z}/{x}/{y}.pbf` (z14~16) 입니다. 지도는 이 타일을 직접 불러오고, 16보다 크게 확대하면 늘려서 씁니다.

> 건물 높이는 화면 표시용 추정치이며 판정 계산에는 쓰지 않음.

## 출처

- 국토교통부 **GIS건물통합정보** (브이월드 공간정보 다운로드), 대전광역시 `AL_D010_30_20261009`
- 원본 파일 날짜 2026-10-09, 데이터 기준일자 2026-10-06
- 컬럼 정의서: 국가중점데이터 컬럼정의서(배포용) — AL_D010 표
- 원본 좌표계 EPSG:5186 (Korea 2000 중부원점 2010), 건물 175,270개

## 처리 기준

| 항목 | 값 |
|---|---|
| 범위 `BBOX` (WGS84) | `null` = 대전 전체. 범위를 주면 건물 **중심점**이 안에 있는 건물을 통째로 남김(경계에서 자르지 않음) |
| 작은 건물 제외 | 도형 면적(원본 좌표계, ㎡) 15㎡ 미만 (창고·부속 구조물) |
| 좌표 | WGS84, 소수점 6자리 |
| 이상값 | 층수 100 초과, `******`(자릿수 넘침), 0 은 null |
| 타일 | z14~16, extent 4096, 단순화 tolerance 3. 레이어 이름 `buildings` |

기준 상수는 `scripts/map/build-buildings.mjs` 맨 위에 있습니다. 시연 권역만 만들고 싶으면 `BBOX = [127.370, 36.360, 127.400, 36.385]` 처럼 적으면 됩니다.

## 타일에 담는 속성

| 속성 | 뜻 |
|---|---|
| `fid` | 1부터 시작하는 짧은 숫자. 원본 id(`srcId`) 정렬 순서로 고정 |
| `h` | **지도가 읽는 최종 높이(m)**. 아래 규칙으로 계산 |
| `floors` | 지상층수 (A26). 없으면 null |
| `d` | 1 이면 높이 정보가 없어 기본 높이(6m)로 정한 건물(`hSource` 가 `default`). 색을 가장 희게 칠하는 데 씀 |

처리 중에는 `srcId`(원본 28자리 id), `height`(원본 높이), `hSource`(`h`를 정한 방법)도 계산하지만, 타일 용량을 줄이려고 타일에는 싣지 않습니다(`hSource` 는 `d` 로만). 용도(`use`)는 빈 값이 많아 뺐습니다.

## 높이 `h` 계산

1. `height`(A16)가 있으면 사용. 단, `height ÷ floors` 가 2m 미만이거나 8m 초과면 이상값으로 보고 2번으로
2. `floors × 층고`. 층고는 도시 전체에서 `height ÷ floors` 가 정상(2~8m)인 건물의 중앙값
   - 저층(1~4층): **4.00m** (표본 73,363)
   - 고층(5층 이상): **3.20m** (표본 7,069)
3. 둘 다 없으면 **6m** (약 2층)

현재 결과 (160,765동):

| hSource | 건물 수 |
|---|---|
| `height` | 78,924 |
| `floors` | 40,107 |
| `default` | 41,734 |

`floors` 가 있는 건물은 74.0% (118,991/160,765) 입니다.

## 그림자 (타일의 `shadows` 레이어)

MapLibre 에는 건물 그림자 기능이 없어서 바닥에 그림자 모양을 깔아 흉내 냅니다. 건물마다 바닥 도형을 해 반대편(북동쪽, 방위 40도)으로 `h × 0.8` m 옮긴 것과 합쳐 볼록 껍질로 감싼 도형 하나입니다.

- 미터 단위인 원본 좌표계에서 계산한 뒤 WGS84 로 변환합니다. 방향·길이 비율은 `src/components/map/map-config.ts` 의 `SHADOW_BEARING_DEG`, `SHADOW_LENGTH_RATIO`
- 대전 전체라 GeoJSON 한 파일(`daejeon-shadows.geojson`)이 아니라 건물과 같은 타일에 `shadows` 레이어로 함께 담습니다. 속성은 `fid`(건물과 같은 값)
- 지도에서는 색 `#CFC6DC`, 진하기 0.35(구간만 보기에서 범위 밖 건물의 그림자는 0.12)

## 나무 (`public/data/daejeon-trees.json`, 시연 권역만)

`scripts/map/build-trees.mjs` (`pnpm map:trees`, `pnpm map:buildings` 가 이어서 실행)

- 공원·숲·잔디 면은 OpenStreetMap(Overpass API)에서 시연 권역(`TREE_BBOX`)만 한 번 받아 `data/raw/osm-green-demo.json` 에 저장해서 씁니다(면 136개)
- 면적 400㎡당 한 그루 정도로, 나무 사이 최소 12m, 권역 전체 최대 3,000그루(넘으면 난수로 골고루 덜어냄, 시드 고정이라 결과가 같음)
- **건물 바닥 위에는 놓지 않습니다.** 수관이 건물에 닿을 만큼 가까운 점은 뺍니다(`data/raw/derived/buildings-footprints.json`, `pnpm map:buildings` 가 건물을 처리하면서 만듭니다). 현재 87그루 제외
- 출력은 나무 점 데이터입니다: `origin`(권역 중심 경도·위도)과 `trees`(각 `[동쪽 m, 북쪽 m, 수관 반지름 m(3~4.5), 꼭대기 높이 m(8~11), 수관 색(#B5C7A0~#A3BA8E 사이)]`). 약 100KB
- 지도(`src/components/map/treesLayer.ts`)는 maplibre 커스텀 레이어 + three.js 로 점마다 구(수관, 위아래로 살짝 눌림)와 원기둥(줄기, 반지름 0.6m)을 InstancedMesh 로 한 번에 그립니다. 부드러운 빛(주변광 + 약한 방향광)만 쓰고 그림자는 없습니다. 건물 레이어와 같은 깊이 버퍼를 써서 건물 뒤의 나무는 가려집니다. 2D 보기에서는 숨깁니다
- 빛 세기는 `TREE_LIGHT` (three 는 람베르트 빛을 1/π 로 나눠서 쓰므로 코드에서 π 를 곱해 "색 × 세기" 로 맞춤)
- 한계: 시연 권역 밖 공원에는 나무가 없습니다. 지도 범위를 넓히려면 `TREE_BBOX` 를 키우고 `TREE_MAX_COUNT` 도 함께 조정

## 대전 경계와 밖 덮기 (`pnpm map:boundary`)

건물 데이터가 대전에만 있어서, 카메라를 기울이면 지평선 쪽 세종 등 대전 밖이 비어 보입니다. 그래서 세계 전체에서 대전 경계를 뚫은 마스크를 바탕색으로 덮어 대전만 보이게 합니다.

- `scripts/map/build-boundary.mjs` 가 OpenStreetMap(Overpass API)에서 대전광역시 행정경계(`admin_level=4`)를 **한 번** 받아 `data/raw/osm-daejeon-boundary.json` 에 저장하고, `public/data/daejeon-boundary.geojson`(경계, 약 441 꼭짓점)과 `public/data/daejeon-mask.geojson`(@turf/turf `mask`)을 만듭니다. 앱이 실행 중에는 이 파일들만 읽고 외부 경계 요청은 하지 않습니다.
- 지도 레이어 순서: 바탕 지도·건물·그림자·나무 → 마스크(대전 밖, 바탕색 100%) → 경계선(연한 선 `#C9C2D6` 1.5px + 바깥 은은한 그림자 `#D9D3E3` 10px/blur 8/0.6). 판정 경로 선과 핀은 대전 안(마스크 구멍)에 있어서 가려지지 않습니다.
- 스크립트가 `MAP_MAX_BOUNDS`(경계 bbox + 사방 2km)와 `MAP_MIN_ZOOM`(1440×900 화면에 대전 전체가 들어오는 줌 10.65)을 계산해서 알려 주고, 값은 `src/components/map/map-config.ts` 에 넣어 두었습니다.
- 기울기 제한: `maxPitch 60`, 줌 12 이하 35°, 줌 14 에서 50°, 줌 15.5 이상 60° (`MAP_PITCH_LIMITS`, `src/components/map/map-limits.ts`). 줌이 바뀔 때마다 `setMaxPitch` 로 맞춥니다.
- 지평선 안개: `style.json` 의 `sky`(하늘·지평선·안개 모두 바탕색, fog-ground-blend 0.4, horizon-fog-blend 0.9, sky-horizon-blend 1)

**출처:** 행정경계 © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright)

## 지도 색 (`pnpm map:style`)

`public/map/style.json` 은 OpenFreeMap Positron 원본(`data/raw/map-style-positron.json`)에 `src/components/map/map-config.ts` 의 `PALETTE`·`ROAD_WIDTHS`·`LIGHT`·`SKY` 를 입혀 `scripts/map/build-map-style.mjs` 가 만듭니다. 색을 바꾸려면 상수를 고치고 `pnpm map:style`.

## 결과 요약

- 원본 175,270동 → 15㎡ 미만 14,505동 제외 → **160,765동**
- 타일 2,426개, 합계 약 38MB (건물 + 그림자, 가장 큰 타일 약 700KB). 배포에서는 압축돼서 전송된다
- 건물 좌표 범위 `[127.248024, 36.192855, 127.553745, 36.498175]`

## 다시 만드는 방법

1. 원본(`AL_D010_30_20261009.shp/.shx/.dbf/.prj`)을 `data/raw/daejeon-buildings/` 에 넣습니다. (`data/raw/` 안의 지도 원본은 `.gitignore` 로 레포에서 빠집니다)
2. `pnpm map:buildings` (약 15초)

같은 원본이면 항상 같은 결과가 나옵니다(스크립트가 마지막에 타일 전체와 나무 파일의 sha256 을 출력).
