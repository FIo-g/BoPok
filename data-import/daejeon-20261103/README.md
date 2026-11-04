# 대전108 조사자료 반영 기록

작업 브랜치: `geo/services-after-trip-schema`. 기존 미커밋 변경을 유지했다. commit/push/merge, 공유 DB 쓰기, 새 관광정보 조사는 하지 않았다.
입력 원본: `C:/Users/이동주/Downloads/보폭_VSCode_데이터와작업지시_20261103` (원본 수정 없음).
이 폴더에는 작업 지침과 매핑 설명만 두며 대용량 원본·사진·원첨부를 프런트나 Git에 넣지 않는다.

## 실제 스키마 확인

공유 DB의 information_schema와 시범 장소 3개의 ID·좌표만 SELECT했다. 현재 공유 places에는 kind가 없고 place_catalog/place_research도 미적용이다.
초기 전체 행 백업 시도는 자동 승인 검토에서 과도한 데이터 복제로 거절되어 실행되지 않았다. 필요한 스키마·시범 3개 열 조회로 범위를 줄여 성공했다.
테스트 대상은 `.pglite/daejeon-20261103-main-test`의 독립 PGlite. 환경 DATABASE_URL과 기존 `.pglite`를 사용하지 않는다.

## 데이터 매핑

| 조사 필드 | 저장/적용 |
| --- | --- |
| 108 places | namespace + candidate + DJ-ID, 원본과 처리결과 모두 보존 |
| exact_name / alias_address + 유효 대표점 | 콘텐츠 ID로 `tourapi-유형-ID`, 시범 3개는 명시적 canonical ID 연결 |
| subsite_only / superset_only / no_match | 장소로 승격하지 않고 pending. 관련시설 정보는 candidate 원문에 보존 |
| 동일 콘텐츠 공유 후보 | 중첩 검토 보류. 이름만 보고 합치지 않음 |
| 기존 장소 | 좌표·이름·속성·지점·구간 덮어쓰기 없음 |
| observations / quarantined | F-ID와 원본 JSON, 수치·단위·범위·방향·원문/조회일·검토상태·caveat 보존 |
| sourceChecks 648 / apiFields 2492 | 원본 JSON 별도 레코드. 조회상태를 시설 안전값으로 옮기지 않음 |
| apiImages 949 | URL·권리코드만 보존. 공개 이미지 0 |
| OSM 4328 / relations | ID·geometry·관계·버전 그대로 보존. 경로·계단 엔진에 주입하지 않음 |
| KNPS 14좌표묶음 / 834 CSV행 메타 | 별도 근거. 현재 개방·0분·난이도 확정값으로 사용하지 않음 |

namespace에는 입력 자료의 SHA256 접두어가 포함된다. 근거·사진·OSM에도 namespace/entity/external_id 복합키를 사용한다.
최신 main 기준 `0005_place-services-research.sql`을 재생성·검토했다. `place_catalog`·`place_research`와 선택 kind 컬럼만 추가하며 DROP/TRUNCATE 없음. 팀의 0003·0004는 수정하지 않았다.
추가 API 계약은 PlaceDetail.research 선택 필드만 사용한다. 보류 문장·이미지·OSM 수치는 상세 응답이나 추천에 넣지 않는다.
기존 필수 불리언은 확인된 휴식/실내로 채택하지 않는 보수값(false)으로만 호환하며, 실제 미확인은 조사 원문과 unverified 안내로 보존한다. 시설 부재의 확정값이 아니다.

## 실제 결과

- 후보108 모두 처리: 신규72, 기존 연결3, 보류33. 기존 값 갱신0, 무조건 통합0.
- 보류 사유: 미매칭26, 부분시설4, 상위권역2, 동일 콘텐츠 중첩1(다른 관련 후보와 중첩). 세부 후보별 결과는 `data/services/research-20261103/dry-run.json`.
- 근거 보류39 유지. 전체 연속 휠체어 접근108 미확인 유지.
- 첫 실제 테스트 적재: 장소72 추가, 연구 레코드17,468 추가. 기존3 포함 총75곳.
- 동일 입력 두 번째: 장소0·연구 레코드0 추가, 연구 레코드17,468 그대로.
- 별도 프로세스로 재실행: 양쪽 모두0 추가, 시범3 좌표 유지,75곳 모두 상세의 미확인 안내 확인.
- 입력 JSON·사용한 GeoJSON2개는 manifest SHA256 검증 완료.
- 127.0.0.1:3001 실제 목록/상세 HTTP200, 목록75곳, 신규 대전문학관 대표점과 research 미확인 안내 확인.

## 실행·복구

```powershell
node --conditions=react-server scripts/data/import-research.mjs --source 'C:/Users/이동주/Downloads/보폭_VSCode_데이터와작업지시_20261103'
node --conditions=react-server scripts/data/import-research.mjs --source 'C:/Users/이동주/Downloads/보폭_VSCode_데이터와작업지시_20261103' --apply-test
```

기본은 DB 쓰기 없는 dry-run이다. `--apply-test`만 고정된 테스트 경로를 연다. 공유 DB 적용 모드는 제공하지 않는다.
각 실행 전 `dumpDataDir()` 전체 백업을 `.pglite/research-test-backups/research-test-backup-시간.tar.gz`에 남긴다. 최신 경로는 applied.json에 있다.
복구 시 3001 서버를 종료하고 백업 Blob을 PGlite `loadDataDir`로 **새 테스트 경로**에 열어 검증한다. 원래 DB를 삭제하거나 공유 DB에 복구하지 않는다. 테스트 DB·백업은 `.pglite/` 제외 정책을 따른다.

## 남은 범위

운영·공유 DB 반영은 승인·머지 후 별도다. 현재 공유 DB 전체를 복제하지 않았으므로 공유 DB의 다른 수집자료와 최종 ID 대조는 적용 직전 필요하다.
33후보의 대표점/중첩 검토, 현장 접근성 검증, 사진 이용조건 확인은 보류한다. 새 관광정보 조사·OSM19곳 추가 수집은 하지 않았다.
화면·전체 검사 최종 결과는 같은 폴더의 검증 기록과 대화 완료 보고를 참고한다.

초기 지도 화면은 로딩 실패 대체 안내가 나왔다. 후속 독립 테스트에서 가상 여행자를 포함한 새 일정으로 **대전문학관 마커 정상 표시를 실제 확인**했다. 초기 실패를 WebGL이나 데이터 문제로 단정하지 않는다. 증빙은 marker-verification.png다.
화면 증빙은 `data/services/research-20261103/preview.png`이다. 로컬 테스트 가상 계정·그룹·여행만 만들었고 운영 계정은 만들지 않았다.

이번 추가/연결 파일: research-import.ts와 테스트, import-research.mjs, schema/place-research.ts와 schema/index.ts, 0005 SQL·스냅샷·journal, PlaceDetail.research 계약, places/index.ts 상세 조회, ResearchInfo.tsx·PlacePicker.tsx, 처리 보고서와 본 문서. 기존 미커밋 파일은 reset/stash/switch/pull하지 않았다.
전체 검증: `pnpm lint`, `pnpm typecheck`, `node node_modules/vitest/vitest.mjs run --maxWorkers=2` (91파일·1281테스트), `pnpm build`, `git diff --check` 통과.
독립 3001 화면에서 테스트 계정·그룹·여행만 생성해 실제 장소 목록 검색·출처·미확인 안내를 확인했다. 외부 AI/TMAP 호출은 하지 않았다.
재실행 전에는 반드시 3001 서버를 종료한다. PGlite는 같은 파일을 두 프로세스에서 열지 않는다. 원래 3000 서버와 공유 DB는 변경하지 않는다.


후속 통합 검사와 최신 main 마이그레이션 충돌 여부는 `data/services/integration-status-20261103.md`를 기준으로 한다. 테스트 DB·백업은 빌드 캐시 밖으로 옮겼다.
