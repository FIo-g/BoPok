담당: 김태형. 보행 계산 엔진(순수 TypeScript, 브라우저·서버 공용). 설계는 docs/roles/ai-engine.md 참고.

## 파일 목록

- `index.ts` — 공개 묶음. 바깥 코드는 `@/lib/engine` 이 문 하나로만 쓴다.
- `constants.ts` — 모든 숫자와 출처 (속도표·키 보정·상한·마진·기본 조건).
- `constants.test.ts` — 상수가 계획의 숫자와 같은지 검사.
- `speed.ts` — 여행자 한 명의 속도 `travelerSpeedMps`와 일행 속도·조건 `groupProfile`.
- `speed.test.ts` — 나이 경계값·키 보정·상한·부모님 80% 비중 테스트.
- `condition.ts` — 걷기 조건 생활 예시 질문 `CONDITION_QUESTIONS`와 답 → 값 `conditionFromAnswers`.
- `condition.test.ts` — 질문 문구·순서와 답 해석 테스트.
- `walk-time.ts` — 구간 하나의 걷는 시간 `walkMinutes`, 범위 `toRange`·`formatRange`, 출발 지점 `startNodeKind`.
- `walk-time.test.ts` — 계단·경사 가중치와 범위 문장 테스트.
- `route.ts` — 하루 경로 이어 붙이기 `buildDayRoute` (장소 안 경로·장소 사이 이동·정보 없음).
- `route.test.ts` — 이동수단별 출발·돌아가는 길·빼기·우회로·쉼터 테스트.
- `required-legs.ts` — 경로 API에 한 번에 물어볼 `requiredLegs` (같은 경로는 한 번).
- `required-legs.test.ts` — 같은 경로 중복 제거·좌표 없는 경로 제외 테스트.
- `judge.ts` — 판정 `judge` (연속 걷기·하루 총·계단 세 상태·부분 판정·판정 이유 문장).
- `judge.test.ts` — 노션 4-2 예시·묶음 끊김·빠진 경로·판정 문장 테스트.
- `quick-fix.ts` — 빠른 수정안 `quickFixes` (A 우회로·선택 구간 빼기 → B 쉼터 → C 택시, 위반이 처음 사라진 단계까지).
- `quick-fix.test.ts` — 노션 4-2 "A 부족 → B 해결"·건너뛰는 단계·계약 통과 테스트.
- `diff.ts` — 버전 비교 숫자 `diffSummary`, 한 줄 `formatDiffItem`, 고정 문장 `fixedChangeSentence`.
- `diff.test.ts` — 바뀐 항목만·순서·문장 테스트.
- `test-fixtures.ts` — 테스트에서만 쓰는 장소 데이터(한밭수목원·과학관).
- `purity.test.ts` — 엔진 폴더의 `.ts` 파일을 검사해 React·DB·fetch·환경 변수를 안 쓰는지 확인.
