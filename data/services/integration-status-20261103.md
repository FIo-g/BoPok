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
| 날씨 | 기존 키로 단기·중기 각각1회 호출, 둘 다HTTP403. 활용승인 여부와 사유는 미확정 |
| 포털 | 로그인 세션 종료, 보안문자 요구. 계정 승인 상태는 로그인 후 확인 필요 |
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

- 공공데이터포털 로그인·보안문자와 날씨2종 활용승인 상태 확인
- Upstage 실제 키 설정 후 작은 임베딩 배치 검증
- 팀 리뷰 후 승인된 공유 DB 적용 (최신 main 통합·마이그레이션 재생성은 완료)

화면 증빙: `research-20261103/marker-verification.png`, `menu-verification.png`, `lodging-verification.png`.
통합 DB는 식별자 기준20,214개 장소이며, 자료원 간 물리적으로 같은 업소를 이름만 보고 병합하지 않았다.
최신 관련 테스트5파일·25개, lint/typecheck/build/diff 검사 통과. 전체91파일·1,281개 통과 기록은 앞선 조사자료 단계이며 이번에는 변경 관련 검사를 다시 실행했다.

별도 범위 결정이 필요한 항목: 비용 직접 입력의 서버 저장·가족 공유. 현재는 화면 계산용이며 새로고침하면 초기화됨을 표시한다.
음식 주의 태그와 접근성 검증값은 근거 없이 채우지 않는다.

최종 추가 확인: 테스트 DB를 캐시 밖으로 옮긴 뒤 빌드·재시작을 거쳐도 숙박22곳과 신규 관광지·조사 안내가 유지됐다. 최종 관련 테스트25개와 lint/typecheck/build/diff 검사는 통과했다. 현재 독립 검증 서버는127.0.0.1:3001이며, 실제 사용자3000 서버와 공유 DB는 변경하지 않았다.

GitHub 업로드 전 최종 검사: 최신 main 기준 pnpm lint, pnpm test --maxWorkers=2(111파일·1,734개 전체 통과), pnpm build, git diff --check 통과. 실제 로컬 인증값 검출0건. 검증 결과는 publish-validation.json에 기록했다.
