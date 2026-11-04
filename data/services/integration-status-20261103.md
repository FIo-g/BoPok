# 이동주 ④·⑥ 통합 검증 — 2026-11-03

브랜치 `geo/services-after-trip-schema`. 기존 작업과 팀원 기능을 보존했다. 사용자의 GitHub 공유 요청으로 작업 브랜치 커밋·push·PR을 준비하며, 공유 DB 적용·PR 머지는 하지 않는다.

| 항목 | 확인 결과 |
| --- | --- |
| 전체 카탈로그 | 관광·문화시설184 + 식당·카페20,000 + 숙박22 = 20,206개 자료, 메뉴90,313개 |
| 메모리 적재 | 20,206개 카탈로그 적재, 재실행0개 추가 |
| 조사자료 | 108후보 전부 처리, 신규72·기존연결3·보류33, 연구레코드17,468개 |
| 통합 테스트 DB | 연구자료와 카탈로그의 같은 콘텐츠 ID는 기존 요약·좌표를 보존하고 원본만 연결 |
| 추천 | 실제 DB에서 식당·카페·숙박 각각10곳 조회. 의미 검색 실연동 전에는 키워드임을 표시 |
| 가격 | 실제 메뉴·숙박25곳 조회,6곳에 가격 선택지 있음. 메뉴 수량 단위 미확인 보존 |
| 택시 실제 연결 | TMAP 자동차112m → 차량당4,800원,3인 기준1인1,600~1,920원(20%); 저속·할증·통행료 별도 |
| 날씨 | 19:18 KST 승인 후 재확인: 기존 키로 단기·중기·기상특보 모두HTTP200·정상코드00. 실제 앱 조회·파서·화면 변환도 통과 |
| 포털 | 사용자가 날씨3종 활용신청·승인을 완료했다. 키 교체 없이 정상 연결 확인 |
| RAG | pgvector 메모리 테스트 통과. 실제 UPSTAGE_API_KEY 미설정으로 외부 임베딩·Neon 인덱싱 미완료 |
| 지도·실제 화면 | 기존 시범3곳과 신규 대전문학관 마커 정상 표시 확인. 실제 국수 메뉴 검색·가격·주의 안내, 대전문학관 기준 숙박거리0.6km·2.9km 순서 확인 |

## 재현과 DB 안전

```powershell
# 날씨 이용권한 확인: 키나 URL을 출력하지 않고 서비스별1회 호출
node --use-system-ca --env-file-if-exists=.env.local scripts/data/verify-weather-access.mjs
# 3001 서버 종료 후 독립 테스트 DB에만 적용
node --conditions=react-server scripts/data/import-research.mjs --source 'C:/Users/이동주/Downloads/보폭_VSCode_데이터와작업지시_20261103' --apply-test
node --conditions=react-server scripts/data/load-service-catalog.mjs --apply-test
```

테스트 DB는 빌드 시 지워지는 `.next`에서 **`.pglite/daejeon-20261103-main-test`**로 변경했다. 기존 다른 PGlite DB는 사용하지 않는다.
백업은 `.pglite/research-test-backups/`, 파일 잠금은 `.pglite/research-test.import.lock`이다.
DB 초기화 완료를 기다린 뒤 백업하며, 서버3001이 실행 중이거나 다른 적재가 잠금을 가지면 쓰기 전에 차단한다. 이 두 차단 동작을 로컬 소켓·잠금으로 검증했다.
원문이 달라지거나 확인되지 않은 기존 ID와 충돌하면 덮어쓰지 않는다. 관측 미확인·보류·부분시설 정보는 원래 범위 그대로 보존한다.

## 최신 GitHub 확인과 적용 전 조건

2026-11-03 공개 GitHub API 확인: **#18은 이미 main에 머지됨**. 최신 main에는 `0004_traveler-health.sql`이 있다.
이후 사용자의 GitHub 업로드 요청으로 최신 main(`bb06259`) 위에 이동주 변경만 재적용했다. 번호 충돌을 해결하고 **`0005_place-services-research`와 스냅샷을 재생성**했다. 팀의 건강 스키마를 포함해 생성했으며 DROP/TRUNCATE 없이 카탈로그·조사자료 테이블과 선택 kind 컬럼만 추가한다.
공유 DB에는 적용하지 않았다. 기존 임시 SQL을 사용한 테스트 DB는 보존하고, 새 이력을 검사할 테스트 DB 경로는 `.pglite/daejeon-20261103-main-test`로 분리했다.
이 문서가 앞선 기록의 '#18 머지 대기' 안내를 대체한다.

## 남은 외부 조건

- Upstage 실제 키 설정 후 작은 임베딩 배치 검증
- 팀 리뷰 후 승인된 공유 DB 적용 (최신 main 통합·마이그레이션 재생성은 완료)

화면 증빙: `research-20261103/marker-verification.png`, `menu-verification.png`, `lodging-verification.png`.
통합 DB는 식별자 기준20,214개 장소이며, 자료원 간 물리적으로 같은 업소를 이름만 보고 병합하지 않았다.
최신 관련 테스트5파일·25개, lint/typecheck/build/diff 검사 통과. 전체91파일·1,281개 통과 기록은 앞선 조사자료 단계이며 이번에는 변경 관련 검사를 다시 실행했다.

별도 범위 결정이 필요한 항목: 비용 직접 입력의 서버 저장·가족 공유. 현재는 화면 계산용이며 새로고침하면 초기화됨을 표시한다.
음식 주의 태그와 접근성 검증값은 근거 없이 채우지 않는다.

최종 추가 확인: 테스트 DB를 캐시 밖으로 옮긴 뒤 빌드·재시작을 거쳐도 숙박22곳과 신규 관광지·조사 안내가 유지됐다. 최종 관련 테스트25개와 lint/typecheck/build/diff 검사는 통과했다. 현재 독립 검증 서버는127.0.0.1:3001이며, 실제 사용자3000 서버와 공유 DB는 변경하지 않았다.

GitHub 업로드 전 최종 검사: 최신 main 기준 pnpm lint, pnpm test --maxWorkers=2(111파일·1,734개 전체 통과), pnpm build, git diff --check 통과. 실제 로컬 인증값 검출0건. 검증 결과는 publish-validation.json에 기록했다.

## PR 업로드 후 보완

- 비용 입력을 여행·버전·일차·장소별로 구분하고, 택시 출발지·도착지·내부 동선·인원 변경도 반영했다. 시간만 바꿀 때는 입력값을 유지한다. 늦은 택시 응답은 직접 수정한 금액을 덮어쓰지 않으며 일정 변경 시 조회를 취소한다.
- 계단 회피를 벡터·키워드 후보의 SQL 개수 제한 전에 적용했다. 기존 역할 문서대로 `present`만 뒤로 보내며 미기록을 접근 가능으로 취급하지 않는다. 예산·이동수단별 완전한 SQL 필터는 확정 비용·통행 근거가 없는 자료에 임의 적용하지 않았다.
- 최신0005 전체 마이그레이션으로 새 독립 테스트 DB를 만들었다. 최초 조사자료72곳·17,468건 입력, 카탈로그20,206건 연결, 총20,214곳 확인. 카탈로그 입력 뒤 조사자료를 다시 실행해도 추가0건·갱신0건이며 기존 시범3곳 좌표를 보존했다.
- 조사자료 재검증은 이름순100개 대신 매핑된ID를 직접 조회한다. 식당2만 곳과 공존해도 기존 장소가 검증 목록에서 누락되지 않는다.
- 공유 LLM API KEY 문서를 다시 확인했으나 공급자 사용 안내만 있고 실제 Upstage 키는 없었다. 키를 추측하거나 다른 공급자의 키로 대체하지 않았다.

위 후속 변경은 PR #29 추가 공유 대상이다. `publish-validation.json`은 최초 PR 업로드 시점, `followup-validation-20261103.json`은 후속 검증 기록이다.

최종 후속 검증(`followup-validation-20261103.json`): 날씨 수정까지 포함한 전체112파일·1,741개 테스트, lint·타입 검사 통과. `pnpm build`는 Turbopack CSS 자식 프로세스 연결 오류가 났으나, `node node_modules/next/dist/bin/next build`와 `pnpm --config.shell-emulator=false build`는 모두 통과했다. 저장소 설정은 바꾸지 않았다.
빌드된3001 화면에서 실제 메뉴5,000원 선택→1인5,000~6,000원, 다른 버전의 금액 미상속, 원래 버전의5,000원 복원을 확인했다. 가상 테스트 계정만 사용했다. 증빙은 `research-20261103/cost-version-verification.png`다.
추가 공유 전 GitHub 확인: PR #29는 열림·미머지이고 main은`bb06259`다. 머지와 공유 DB 적용은 이번 push에 포함하지 않는다.

## 날씨 승인 후 실제 연결 — 19:20 KST

단기·중기·기상특보 활용승인 후 같은 `TOURAPI_SERVICE_KEY`로 전부HTTP200·정상코드00을 확인했다. `weather-access-check.json`이 앞선403기록을 대체한다.
`verify-weather-integration.mjs`는 기존 김태형 담당 조회·계약 검사·화면 변환 함수를 그대로 호출하며 DB에는 쓰지 않는다. 실제5회 요청(단기2쪽·중기육상·중기기온·특보현황)으로 오늘부터10일 뒤까지11일의 예보를 확인했다(`weather-integration-check.json`). 특보 응답의 대전 경고가 없을 때 경고를 지어내지 않는다.
실제 단기 응답 끝에 범위 밖 다음 날0시 자료가 섞이는 사례를 발견했다. `parse.ts`에서 문서의 단기예보 기간(02~14시 발표는3일 뒤, 17~23시는4일 뒤)을 넘는 날짜를 제외해 중기예보가 가려지지 않게 했다. 회귀 테스트를 먼저 실패시키고 수정 후 날씨·관련API15파일·223개 테스트와 lint가 통과했다. 날씨 모듈 보완은 김태형 리뷰 대상이다.

프로덕션 빌드·타입 검사도 `pnpm --config.shell-emulator=false build`로 통과했다. 독립3001 서버의 가상 계정으로 `GET /api/trips/:id/weather`가HTTP200·11일 모두ok·short/mid를 반환함을 검증했다(`weather-api-check.json`). 브라우저에서11/5 비 예보·우산/미끄럼 주의 안내와11/8 중기예보(최고9℃·최저1℃) 및 출처·발표시각을 확인했다. 증빙은 `research-20261103/weather-rain-verification.png`, `weather-mid-verification.png`다. 실제 사용자 여행과 공유 DB는 변경하지 않았다. 코드·실행 결과·화면 증빙을 PR #29의 추가 커밋으로 공유한다.

```powershell
node --use-system-ca --env-file-if-exists=.env.local --conditions=react-server scripts/data/verify-weather-integration.mjs
```
