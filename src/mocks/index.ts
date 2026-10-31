// 화면(AuthScreen)이 쓰는 연습용 로그인 계정. 목업 본체(mock-api·seed)는 여기서 내보내지 않는다 — 화면이 이 파일을 가져와도
// 목업 데이터가 번들에 딸려 오지 않게 하려는 것이다. 본체는 src/lib/api-client/lazy-mock.ts 가 목업을 켠 빌드에서만 불러온다.
// 값은 NEXT_PUBLIC_USE_MOCKS=1 인 빌드에만 들어간다. 끈 빌드에서는 조건이 빌드 때 접혀 빈 문자열이 되고 비밀번호 글자가 번들에 남지 않는다.
// 값은 seed.ts 의 DEMO_EMAIL·DEMO_PASSWORD 와 같아야 한다 (demo-account.test.ts 가 확인한다).
export const DEMO_EMAIL = process.env.NEXT_PUBLIC_USE_MOCKS === '1' ? 'demo@bopok.test' : ''
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_USE_MOCKS === '1' ? 'bopok1234' : ''
