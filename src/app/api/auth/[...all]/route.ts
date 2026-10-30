// 로그인 API 입구. 이 파일 하나가 /api/auth 아래를 전부 만든다 —
// sign-up/email, sign-in/email, get-session, sign-out ([...all]은 '그 아래 모든 경로').
import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '@/lib/auth/auth'

// 인스턴스를 바로 넘기지 않고 함수로 감싼다 — 빌드할 때 Next.js가 이 파일을 읽으면서
// DB(PGlite)를 열지 않게. 요청이 올 때 처음 열린다 (src/lib/db/client.ts와 같은 이유).
export const { GET, POST } = toNextJsHandler(request => getAuth().handler(request))
