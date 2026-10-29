# 0단계: 레포 초기화 + 공용 타입 초안 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네 역할이 같은 뼈대 위에서 동시에 일을 시작할 수 있도록 Next.js 레포를 초기화하고, DB 연결 코드와 `src/lib/contracts` 공용 타입 초안(zod)을 만든다.

**Architecture:** `create-next-app@16.4.3`으로 임시 폴더에 만든 표준 설정을 레포로 옮기고(기존 `AGENTS.md`·`CLAUDE.md`·`docs/` 유지), vitest·Drizzle·Neon·zod를 더한다. 공용 타입은 zod 스키마가 원본이고 TypeScript 타입은 `z.infer`로 뽑는다. 모든 작업은 관리자(김태형) 권한으로 `main`에 바로 올린다. 공용 타입은 초안으로 올리고, 팀원은 main의 초안을 보고 고칠 점을 각자 PR로 낸다.

**Tech Stack:** Next.js 16.4.3, React 19, TypeScript(strict), Tailwind 4, pnpm 12, ESLint(eslint-config-next), vitest 5, zod 4, drizzle-orm 0.45 + drizzle-kit 0.31, @neondatabase/serverless 1.x, server-only

**Spec:** `docs/superpowers/specs/2026-10-29-bopok-mvp-design.md` (10장 기술 구조), `docs/roles/common.md` (0단계, 공용 타입 초안), `AGENTS.md` (규칙)

## Global Constraints

- Next.js는 `16.4.3`으로 고정(시안 `Bopok`과 같음). Next 코드를 쓰기 전 `node_modules/next/dist/docs/` 확인(AGENTS.md 2장)
- 패키지 매니저 pnpm. `npm`/`yarn` 잠금 파일을 만들지 않는다
- TypeScript `strict: true`, `any` 금지, 경로 별칭 `@/*` → `./src/*`
- 단위는 이름 끝에: `distanceM`, `restMin`, `speedMps`, `durationMin`, `heightCm`, `fareKrw`. 좌표는 `[경도, 위도]`
- 서버 전용 파일은 맨 위 `import 'server-only'`
- 주석·문서는 한국어
- `pnpm lint && pnpm test && pnpm build`가 **환경 변수 없이도** 통과해야 한다 (Vercel 미리보기·새로 받은 팀원 대비)
- 키 값은 어디에도 커밋하지 않는다. `.env.example`에는 이름만

## Review Focus

1. **좌표 순서 뒤바뀜** — `[위도, 경도]`로 넣으면(대전: `[36.37, 127.38]`) 스키마가 거부해야 한다 → Task 3 `Coord` 테스트
2. **`DATABASE_URL` 없음** — import만 해서는 터지지 않고(빌드 통과), 실제로 DB를 쓸 때 한국어로 원인을 알려 주는 에러 → Task 2 테스트
3. **vitest에서 `server-only` import** — 서버 전용 파일을 테스트가 import해도 죽지 않아야 한다 → Task 2 테스트(클라이언트 파일 import)
4. **경로 키의 소수점 흔들림** — `127.380000001`과 `127.38`이 다른 `legKey`가 되면 경로 캐시가 매번 빗나간다 → Task 3 `legKey` 반올림 테스트
5. **빈 의견** — 반응도 없고 한 줄 의견도 없는 의견은 거부 → Task 3 `Opinion` 테스트

---

## File Structure

```
package.json, pnpm-lock.yaml, pnpm-workspace.yaml   (Task 1)
tsconfig.json, next.config.ts, eslint.config.mjs, postcss.config.mjs (create-next-app 산출물 그대로)
vitest.config.ts                                     (Task 1, Task 2에서 server-only 별칭 추가)
.env.example, .gitignore(병합)                        (Task 1, Task 2)
src/app/layout.tsx, src/app/page.tsx, src/app/globals.css   (Task 1 — 자리만, 오하연이 이어받음)
src/lib/{engine,ai,geo,places,trips,auth}/README.md  (Task 1 — 담당자·역할 문서 안내 한 줄)
scripts/data/README.md, data/README.md               (Task 1)
drizzle.config.ts                                    (Task 2)
src/lib/db/client.ts, src/lib/db/client.test.ts      (Task 2)
src/lib/db/schema/index.ts                           (Task 2)
src/test/server-only-stub.ts                         (Task 2)
src/lib/contracts/common.ts                          (Task 3) Coord, Confidence, SourceInfo, StairsStatus, Transport, ApiError
src/lib/contracts/traveler.ts                        (Task 3) Sex, Pace, Condition, Traveler
src/lib/contracts/place.ts                           (Task 3) PlaceNode, PlaceSegment, PlaceSummary, PlaceDetail
src/lib/contracts/leg.ts                             (Task 3) LegEnd, LegRequest, Leg, legKey()
src/lib/contracts/trip.ts                            (Task 3) Stop, TripVersion, Reaction, Opinion
src/lib/contracts/judge.ts                           (Task 3) Minutes, Verdict, Violation, SegmentResult, StopResult, LegResult, JudgeInput, JudgeResult, JudgeSummary
src/lib/contracts/index.ts                           (Task 3) 모두 다시 내보내기
src/lib/contracts/contracts.test.ts                  (Task 3)
docs/roles/common.md                                 (Task 4 — 0단계 진행 상황 표시)
```

---

### Task 1: Next.js 레포 뼈대

**Files:**
- Create: 위 File Structure의 Task 1 항목
- Modify: `.gitignore` (create-next-app 것과 기존 것 병합)

**Interfaces:**
- Produces: `pnpm dev | test | lint | build` 스크립트, `@/*` 별칭, `vitest.config.ts`(Task 2가 수정)

- [ ] **Step 1: 임시 폴더에 표준 프로젝트 만들기**

레포 밖의 임시 폴더(`$SCRATCH`, 실행하는 세션의 스크래치 폴더)에서:

```bash
cd "$SCRATCH" && rm -rf bopok-scaffold
pnpm create next-app@16.4.3 bopok-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --skip-install --disable-git --yes
```
플래그가 거부되면 `pnpm create next-app@16.4.3 --help`로 같은 뜻의 플래그를 찾는다. Expected: `$SCRATCH/bopok-scaffold/package.json` 생성

- [ ] **Step 2: 레포로 옮기기**

`bopok-scaffold`의 파일을 `26_SVC_Seoul`로 복사하되 **기존 `AGENTS.md`, `CLAUDE.md`, `docs/`, `.github/`는 덮어쓰지 않는다.** create-next-app이 만든 `AGENTS.md`/`CLAUDE.md`/`README.md`가 있으면 버리고, `public/`의 예제 SVG도 버린다. `.gitignore`는 기존 줄(`.superpowers/`, `.env`, `.env*.local`)을 유지하며 create-next-app 줄을 합친다(`.env*`는 쓰지 말고 `.env.example`이 커밋되게 `.env`, `.env*.local`만).

- [ ] **Step 3: 패키지 이름과 스크립트**

`package.json`: `"name": "bopok"`, `"private": true`, `next`는 `16.4.3` 고정. 스크립트에 `"test": "vitest run --passWithNoTests"`, `"typecheck": "tsc --noEmit"` 추가. devDependencies에 `vitest@^5`.

- [ ] **Step 4: `vitest.config.ts`**

`defineConfig({ resolve: { alias: { '@': <src 절대경로> } }, test: { environment: 'node', include: ['src/**/*.test.ts'] } })`

- [ ] **Step 5: 자리 화면**

`src/app/layout.tsx`: `<html lang="ko">`, metadata `title: '보폭'`, `description: '부모님 걸음에 맞춘 대전 하루 여행'`. `src/app/page.tsx`: 큰 제목 "보폭"과 한 줄 "준비 중입니다". `globals.css`는 `@import 'tailwindcss';`와 `body` 기본 글자 크기 18px만. (화면은 오하연이 이어받는다)

- [ ] **Step 6: 담당 안내 README**

`src/lib/engine/README.md` 등 각 폴더에 한 줄: `담당: <이름>. 설계는 docs/roles/<역할>.md 참고.` — engine·ai → 김태형/ai-engine.md, geo·places → 이동주/data-geo.md, trips·auth → 김경선/account-trip.md. `scripts/data/README.md`, `data/README.md` → 이동주/data-geo.md

- [ ] **Step 7: `.env.example`**

`docs/roles/common.md` 2장의 이름을 값 없이: `DATABASE_URL=`, `BETTER_AUTH_SECRET=`, `BETTER_AUTH_URL=http://localhost:3000`, `UPSTAGE_API_KEY=`, `OPENCODE_API_KEY=`, `TMAP_APP_KEY=`, `TOURAPI_SERVICE_KEY=`, `NEXT_PUBLIC_USE_MOCKS=1` (각 줄 위에 한국어 주석으로 쓰는 곳)

- [ ] **Step 8: 설치와 검사**

Run: `pnpm install && pnpm lint && pnpm test && pnpm build`
Expected: 모두 성공. `pnpm test`는 "No test files found"여도 0으로 끝남. `pnpm dev`를 띄웠을 때 Next가 `AGENTS.md` 끝에 안내 블록을 붙이면 그대로 둔다

- [ ] **Step 9: 커밋 (main)**

```bash
git add -A ':!.superpowers'
git commit -m "chore: Next.js 16 레포 초기화 (pnpm, Tailwind 4, ESLint, vitest)"
```

---

### Task 2: DB 연결 (Drizzle + Neon)

**Files:**
- Create: `drizzle.config.ts`, `src/lib/db/client.ts`, `src/lib/db/schema/index.ts`, `src/test/server-only-stub.ts`, `src/lib/db/client.test.ts`
- Modify: `package.json`(의존성·스크립트), `vitest.config.ts`(별칭)

**Interfaces:**
- Consumes: Task 1의 vitest 설정
- Produces: `getDb(): NeonHttpDatabase<typeof schema>` (`src/lib/db/client.ts`), `schema` 묶음(`src/lib/db/schema/index.ts` — 파트별 파일을 여기서 다시 내보냄)

- [ ] **Step 1: 의존성**

`pnpm add drizzle-orm @neondatabase/serverless server-only zod` / `pnpm add -D drizzle-kit`. 스크립트: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:studio": "drizzle-kit studio"`

- [ ] **Step 2: vitest에서 `server-only` 무력화**

`src/test/server-only-stub.ts`(빈 모듈, 주석: "vitest(node)에서는 server-only 검사를 건너뛴다"), `vitest.config.ts`의 `resolve.alias`에 `'server-only': <stub 절대경로>` 추가

- [ ] **Step 3: 실패하는 테스트**

```ts
// src/lib/db/client.test.ts
describe('getDb', () => {
  it('import만으로는 에러가 나지 않는다', async () => {
    await expect(import('./client')).resolves.toBeDefined()
  })
  it('DATABASE_URL이 없으면 원인을 알려 주는 에러', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { getDb } = await import('./client')
    expect(() => getDb()).toThrow(/DATABASE_URL/)
  })
})
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm test src/lib/db` → Expected: FAIL (`./client` 없음)

- [ ] **Step 5: `src/lib/db/client.ts`, `schema/index.ts`, `drizzle.config.ts`**

`client.ts`: `import 'server-only'`, `getDb()`는 처음 부를 때 `process.env.DATABASE_URL`을 읽어 `drizzle(neon(url), { schema })`를 만들고 재사용. 없으면 `throw new Error('DATABASE_URL이 없습니다. .env.local에 Neon 연결 주소를 넣어 주세요 (.env.example 참고).')`. `schema/index.ts`: 지금은 비어 있음 + 주석 "파트별 스키마 파일(auth.ts, groups.ts, trips.ts — 김경선 / places.ts — 이동주)을 만들면 여기서 export * 한다". `drizzle.config.ts`: `schema: './src/lib/db/schema/index.ts'`, `out: './drizzle'`, `dialect: 'postgresql'`, `dbCredentials.url: process.env.DATABASE_URL ?? ''`

- [ ] **Step 6: 통과 확인 + 환경 변수 없이 빌드**

Run: `pnpm test && env -u DATABASE_URL pnpm build` → Expected: PASS, 빌드 성공

- [ ] **Step 7: 커밋 후 main에 올리기**

```bash
git add -A ':!.superpowers'
git commit -m "chore: Drizzle + Neon 연결 코드와 vitest server-only 처리"
git push origin main
```

---

### Task 3: 공용 타입 초안 (`src/lib/contracts`)

**Files:**
- Create: `src/lib/contracts/{common,traveler,place,leg,trip,judge,index}.ts`, `src/lib/contracts/contracts.test.ts`

**Interfaces:**
- Produces: 각 이름마다 zod 스키마 `XxxSchema`와 타입 `Xxx = z.infer<typeof XxxSchema>`. 필드는 `docs/roles/common.md` 3장 초안 그대로이며, 아래만 초안에 더해 정한다:
  - `CoordSchema = z.tuple([경도 -180~180, 위도 -90~90])`
  - `ApiErrorSchema = { error: { code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_request' | 'expired' | 'ai_failed' | 'external_api_failed', message: string } }` (common.ts)
  - `SegmentResultSchema = { segmentId, label, time: Minutes, stairsStatus, stairsCount?, status: 'ok' | 'warn', source?, checkedAt?, confidence }`
  - `StopResultSchema = { stopKey, placeId: string | null, known: boolean, walk: Minutes, segments: SegmentResult[] }`
  - `LegResultSchema = { legKey, fromStopKey, toStopKey, mode: Transport, walkTime: Minutes | null (걷기가 아니면 null), rideMin: number | null, stairsStatus, status: 'ok' | 'warn' }`
  - `legKey(req: LegRequest): string` — 끝점마다 `nodeId`가 있으면 `${placeId}/${nodeId}`, 없으면 좌표를 소수점 5자리로 반올림한 `${경도},${위도}`, 형식 `${from}>${to}:${mode}`
  - 숫자 제약: 거리·시간·나이·키는 0 이상(`distanceM`, `durationMin`, `visitMin`, `restMin` 등), `age`는 0~120, `heightCm`은 50~250, `Stop.startTime`·`reservedAt`은 `HH:mm`
  - `OpinionSchema`: `reactions`가 비어 있고 `comment`도 없으면 거부, `comment`는 100자 이하

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/contracts/contracts.test.ts — 기대값 중심으로
describe('Coord', () => {
  it('대전 [경도, 위도]는 통과', () => expect(CoordSchema.parse([127.3845, 36.3504])).toEqual([127.3845, 36.3504]))
  it('[위도, 경도]로 뒤바뀌면 거부', () => expect(CoordSchema.safeParse([36.3504, 127.3845]).success).toBe(false))
})
describe('PlaceSegment', () => {
  it('stairsStatus는 세 값만', () => expect(PlaceSegmentSchema.safeParse({ ...segment, stairsStatus: 'none' }).success).toBe(false))
  it('거리 음수 거부', () => expect(PlaceSegmentSchema.safeParse({ ...segment, distanceM: -1 }).success).toBe(false))
  it('예시 구간 통과', () => expect(PlaceSegmentSchema.parse(segment)).toEqual(segment))
})
describe('legKey', () => {
  it('노드가 있으면 장소/노드로', () => expect(legKey(nodeReq)).toBe('hanbat/exit>science/parking:car'))
  it('좌표는 소수점 5자리 반올림', () =>
    expect(legKey({ from: { coord: [127.380000001, 36.37] }, to: { coord: [127.38, 36.370000004] }, mode: 'walk' }))
      .toBe('127.38000,36.37000>127.38000,36.37000:walk'))
  it('이동수단이 다르면 다른 키', () => expect(legKey({ ...nodeReq, mode: 'taxi' })).not.toBe(legKey(nodeReq)))
})
describe('Opinion', () => {
  it('반응도 의견도 없으면 거부', () => expect(OpinionSchema.safeParse({ ...opinion, reactions: [], comment: undefined }).success).toBe(false))
  it('한 줄 의견만 있어도 통과', () => expect(OpinionSchema.safeParse({ ...opinion, reactions: [], comment: '너무 멀어' }).success).toBe(true))
  it('의견 101자 거부', () => expect(OpinionSchema.safeParse({ ...opinion, comment: '가'.repeat(101) }).success).toBe(false))
})
describe('Traveler', () => {
  it('조건이 비어 있어도 통과 (잘 모르겠어요)', () => expect(TravelerSchema.parse({ ...traveler, condition: {} }).condition).toEqual({}))
  it('나이 130 거부', () => expect(TravelerSchema.safeParse({ ...traveler, age: 130 }).success).toBe(false))
})
describe('Stop', () => {
  it('시간 형식 HH:mm만', () => expect(StopSchema.safeParse({ ...stop, startTime: '10시' }).success).toBe(false))
})
describe('JudgeResult', () => {
  it('예시 판정 결과 통과', () => expect(JudgeResultSchema.parse(judgeResult)).toEqual(judgeResult))
})
```
예시 데이터(`segment`, `nodeReq`, `opinion`, `traveler`, `stop`, `judgeResult`)는 파일 위쪽에 한밭수목원 기준으로 만든다(`nodeReq` = `{ from: { placeId: 'hanbat', nodeId: 'exit', coord: [...] }, to: { placeId: 'science', nodeId: 'parking', coord: [...] }, mode: 'car' }`).

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/lib/contracts` → Expected: FAIL (모듈 없음)

- [ ] **Step 3: 스키마 구현**

파일별로 `docs/roles/common.md` 3장의 필드를 zod로 옮기고 위 Interfaces의 추가 결정을 반영한다. 파일 맨 위에 "이 파일을 바꾸면 프론트와 관련 담당이 함께 리뷰" 주석. `index.ts`는 모두 `export *`. 서버 전용이 아니므로 `server-only`를 넣지 않는다(브라우저·엔진도 씀).

- [ ] **Step 4: 통과 확인**

Run: `pnpm test && pnpm lint && pnpm build` → Expected: 모두 성공

- [ ] **Step 5: 커밋**

```bash
git add src/lib/contracts
git commit -m "feat(ai): 공용 타입 초안 (zod 스키마) 추가"
```

---

### Task 4: 문서 정리와 main에 올리기

**Files:**
- Modify: `docs/roles/common.md` (1장 표에 진행 상황 열 추가)

- [ ] **Step 1: 진행 상황 표시**

`docs/roles/common.md` 1장 표에 "상태" 열: 레포 초기화 = 완료, Neon·Vercel 연결 = **계정 필요(김태형이 직접)**, contracts = 초안 main에 있음(각자 자기 타입 확인 후 고칠 점은 PR로), 목업 = 오하연 대기. 3장 머리에 "코드 초안: `src/lib/contracts`" 한 줄

- [ ] **Step 2: 커밋·push**

```bash
git add docs/roles/common.md docs/superpowers/plans
git commit -m "docs: 0단계 진행 상황 표시와 구현 계획"
git push origin main
```
Expected: main에 push 성공
