// 화면은 이 파일의 api 만 부른다. NEXT_PUBLIC_USE_MOCKS=1 이면 src/mocks 의 가짜 데이터, 아니면 실제 서버 API.
// 환경 변수는 빌드할 때 값이 박히므로, 쓰지 않는 쪽 코드는 번들에서 빠진다.
import { mockApi } from '@/mocks'
import { realApi } from './real'
import type { Api } from './types'

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === '1'

export const api: Api = USE_MOCKS ? mockApi : realApi

export { ApiRequestError, isApiError } from './http'
export type { Api, PlaceQuery, SignInInput, SignUpInput } from './types'
