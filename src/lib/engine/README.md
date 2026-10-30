담당: 김태형. 보행 계산 엔진(순수 TypeScript, 브라우저·서버 공용). 설계는 docs/roles/ai-engine.md 참고.

## 파일 목록

- `index.ts` — 공개 묶음. 바깥 코드는 `@/lib/engine` 이 문 하나로만 쓴다.
- `constants.ts` — 모든 숫자와 출처 (속도표·키 보정·상한·마진·기본 조건).
- `constants.test.ts` — 상수가 계획의 숫자와 같은지 검사.
- `speed.ts` — 여행자 한 명의 속도 `travelerSpeedMps`와 일행 속도·조건 `groupProfile`.
- `speed.test.ts` — 나이 경계값·키 보정·상한·부모님 80% 비중 테스트.
- `condition.ts` — 걷기 조건 생활 예시 질문 `CONDITION_QUESTIONS`와 답 → 값 `conditionFromAnswers`.
- `condition.test.ts` — 질문 문구·순서와 답 해석 테스트.
- `purity.test.ts` — 엔진 폴더의 `.ts` 파일을 검사해 React·DB·fetch·환경 변수를 안 쓰는지 확인.
