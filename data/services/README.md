# ④ 장소·추천 / ⑥ 비용 — 이동주

2026-11-03 수집·구현 기록. GitHub 공유용 작업 브랜치에서 구현·검증한 범위다. 공유 DB에는 쓰지 않았으며 실제 배포 적용은 팀 리뷰 후 진행한다.

## 실제 확보한 자료

| 자료 | 범위 | 결과 |
| --- | --- | --- |
| [대전광역시 음식점 정보](https://www.data.go.kr/data/15098146/openapi.do) | API 수록 업소 전체 | 식당·카페 20,000곳, 카페 업종 2,487곳, 메뉴 90,450개 |
| [한국관광공사 TourAPI](https://www.data.go.kr/data/15101578/openapi.do) | 대전 숙박(32) | 22곳, 객실 상세 10곳·40유형, 숫자 객실 요금 3곳 |
| 같은 TourAPI | 대전 관광지(12)·문화시설(14) | 132곳 + 52곳 = 184곳 |

전부 좌표가 있다. API 수록 범위이며 현재 영업 여부·가격 최신성·대전 전체 업소 수를 보장하지 않는다.
전체 원본·출처·API 수집일·신뢰 등급 B를 보존한다. 원본은 `data/raw/` 아래 Git 제외 파일이며 키는 저장하지 않는다.
빈 메뉴명을 제외하면 공용 계약에 연결할 메뉴는 90,313개다. 숫자로 읽은 가격도 수량 단위는 미확인이다.

`canonical-tourapi.json`은 이름·주소·공식 홈페이지를 대조한 시범 3곳의 명시적 연결이다.
기존 ID·좌표·내부 데이터는 보존하고 TourAPI 자료만 연결한다. 신규 관광지는 181곳이다.
기존 3곳을 포함한 수집 자료의 고유 장소는 총 20,206곳이다.

## 구현

- 수집: 대전시 HTTPS 공개 API(키 불필요), TourAPI KorService2. 최신 `ldongCode2`·`lclsSystmCode2`·`lDongRegnCd` 사용. 캐시·실패 후 재개·요청 상한·오프라인 재생성을 지원한다.
- DB: 기존 `places`에 선택 `kind`, 별도 `place_catalog`에 메뉴·검색문·원문·해시. 전체 입력 검사 후 적재한다. 같은 자료는 건너뛰고 다른 내용은 덮어쓰지 않는다. 새 SQL 적용 전에도 기존 목록·상세 조회는 유지한다.
- 추천: `POST /api/places/recommendations`, `searchCandidates({ query?, kind?, ... })`. Neon pgvector 코사인 검색 + Upstage **Solar Embedding 2(1024차원)**. query/passage 모델을 구분한다. 키·인덱스·API가 없으면 `method: keyword`로 실제 검색 방식을 표시한다.
- AI: 실제 장소 검색·이름 매칭·POI 함수 연결. 관광지가 식당 2만 곳에 밀리지 않도록 종류별 후보를 확보한다. 날짜 처리·권한 정책은 변경하지 않는다.
- 화면: 관광지·식당·카페·숙박 탭, 메뉴·가격·출처. 기준 방문지·다음 방문지로 직선거리/우회를 비교한다. 실제 이동 경로·시간은 TMAP·엔진에서 별도 확인한다.
- 비용: 입장료 원문·메뉴·객실당 1박 공시 가격·TMAP 경로 기반 택시 추정. 1인/공유 금액과 수량을 정해 엔진에서 합산하고 여유 20% 범위를 표시한다. 직접 입력은 현재 화면 계산용이며 새로고침하면 초기화된다. 저장·공유는 아직 없다.
- 미확인 금액은 무료가 아니다. 착석·실내·음식 주의 태그를 추측하지 않는다. `foodTags: []`는 안전하다는 뜻이 아니다. 숙박 가격은 실시간 예약가가 아니다.

택시는 [대전시 2026-11-01 요금](https://www.daejeon.go.kr/drh/board/boardNormalView.do?boardId=normal_0189&menuSeq=6825&ntatcSeq=1525249286)을 쓴다.
기본 1,650m 4,800원, 이후 125m당 100원이다. 화면 견적에는 정체·심야·시외 할증·통행료를 포함하지 않는다. 차량당 4명 가정과 차량 수를 확인·수정한다.

## 수집·파일 검사

프로젝트 루트 PowerShell에서 실행한다. 키는 `.env.local`에만 둔다. 이미지 파일은 내려받지 않는다.

```powershell
node --use-system-ca --conditions=react-server scripts/data/fetch-daejeon-food.mjs --snapshot 2026-11-03
node --use-system-ca --env-file-if-exists=.env.local --conditions=react-server scripts/data/fetch-services.mjs --snapshot 2026-11-03 --types 32
node --use-system-ca --env-file-if-exists=.env.local --conditions=react-server scripts/data/fetch-services.mjs --snapshot 2026-11-03-attractions --types 12,14 --max-requests 800
# 원본 재생: 수집 명령에 --offline 추가 (외부 호출 0회)
# 기본은 파일 검사만. 공용 DB 연결/쓰기를 하지 않는다.
node --conditions=react-server scripts/data/load-service-catalog.mjs
# 메모리 DB에만 전체 마이그레이션·기존 3곳·수집 자료를 두 번 넣어 검사
node --conditions=react-server scripts/data/load-service-catalog.mjs --verify-memory
```

## 머지·적용 순서와 남은 실제 연결

1. GitHub 업로드 요청에 따라 최신 main(`bb06259`) 위로 이동주 커밋만 재적용했다. 팀의 `0004_traveler-health`를 보존하고 장소 카탈로그·조사자료 SQL을 **`0005_place-services-research`로 재생성**했다. 건강·날씨·여러 날 일정·채팅 연결을 보존했다.
2. **AGENTS 8장에 따라 main에 머지된 SQL만** 공용 DB에 적용한다. #18의 선적용 예외는 관리자 판단 사항이며 이 작업에서는 적용하지 않았다.
3. 장소 SQL 머지·적용 후 `load-service-catalog.mjs --apply`로 적재한다. 스크립트는 `origin/main`과 SQL이 같은지 확인하며 마이그레이션 자체는 실행하지 않는다.
4. `scripts/data/sql/place-embeddings.sql`도 main 반영 후 `place-vector-index.mjs --install-schema`로 설치한다. 기본 Drizzle 마이그레이션과 분리해 기존 PGlite 테스트를 유지한다.
5. 실제 `UPSTAGE_API_KEY`는 현재 미설정이다. 설정 후 작은 배치부터 검증한다. 전체 임베딩을 자동 실행하지 않는다. 실제 Upstage 연결·공용 DB 인덱싱은 미검증이다.

```powershell
# 해당 SQL의 main 머지·공용 DB 적용 후에만 실행
node --env-file-if-exists=.env.local --conditions=react-server scripts/data/load-service-catalog.mjs --apply
node --env-file-if-exists=.env.local --conditions=react-server scripts/data/place-vector-index.mjs --install-schema
node --env-file-if-exists=.env.local --conditions=react-server scripts/data/place-vector-index.mjs --index --max-requests 1 --limit 16
```

## 검증·리뷰

단위 테스트는 가상 API 응답과 메모리 DB만 쓴다. 실제 pgvector 확장으로 코사인 순위·종류 필터·원문 재호출 방지를 검사한다. 고정 숫자로 인원 분할·수량·20%·택시 거리 구간을 확인한다.
실제 자료 전체 파일 검사는 20,206곳·메뉴 90,313개로 통과했다. 음식·숙박 원본 오프라인 재생성도 성공했다.
관광지를 포함한 전체20,206개 카탈로그의 메모리 적재와 두 번째 실행(추가0개)을 검증했다. 이후 조사자료와 실제 테스트 DB에서 통합해 식당·카페·숙박 추천과 가격 조회까지 검증했다.
PR #29 업로드 시점에는 최신 main 기준 전체 111개 파일·1,734개 테스트, lint·프로덕션 빌드·`git diff --check`가 모두 통과했다(`publish-validation.json`). 후속 보완 검사는 아래 통합 기록을 따른다.
독립 테스트 DB에서 신규 관광지 마커, 식당 메뉴·가격, 기준 관광지 주변 숙박을 화면으로 확인했다. 실제 사용자 서버3000의 공유 DB에 새 자료가 반영됐다는 뜻은 아니다.
새 개발 의존성 `@electric-sql/pglite-pgvector@0.0.14`는 기존 PGlite 0.5.13과 호환되는 실제 벡터 SQL 테스트용이다.
리뷰어: 오하연(장소 선택·CostSlot·API 클라이언트), 김태형(임베딩·AI 연결·비용 엔진), 김경선(#18·DB 순서). 공용 타입 변경도 함께 확인받는다.

최신 통합 결과·제약은 `integration-status-20261103.md`, 실제 입력 결과는 `catalog-integration-test.json`을 참고한다.
테스트 DB는 빌드 캐시 밖 `.pglite/daejeon-20261103-main-test`, 백업은 `.pglite/research-test-backups`다. `--apply-test`는3001 서버 실행·동시 적재를 쓰기 전에 차단한다.


GitHub 공유: [PR #29](https://github.com/FIo-g/BoPok/pull/29). 원자료는 Git에 포함하지 않아 공유 DB 적재 담당에게 별도로 전달해야 한다.

후속 보완: 버전·장소·택시 양 끝과 일행 수가 바뀌면 이전 비용을 연결하지 않는다. 택시 조회 중 사용자가 수정한 금액도 보존한다. 계단 회피는 벡터·키워드 후보의 SQL 제한 전에 `present`인 장소를 뒤로 보낸다(미기록은 안전 판정이 아니다).
최신0005가 적용된 통합 테스트 DB에서 20,214곳과 조사자료17,468건을 확인했으며, 카탈로그·조사자료 재실행 추가는 모두0건이다. 최초 입력은 `research-20261103/initial-main-test.json`, 통합 후 재실행은 `research-20261103/applied.json`에 기록한다.

날씨 연결은19:18 KST에 해결됐다. 사용자가 단기·중기·기상특보3종을 승인받은 뒤 같은 포털 키로 모두HTTP200·정상코드00을 확인했다. 실제 앱 조회·파서·화면 변환도11일 예보로 검증했다(`weather-integration-check.json`). 추가 키나 환경 변수 변경은 없다. 실제 연결 검사 명령은 위 통합 검증 기록을 따른다.
