// 화면은 이 파일의 api 만 부른다. NEXT_PUBLIC_USE_MOCKS=1 이면 src/mocks 의 가짜 데이터, 아니면 실제 서버 API.
// 환경 변수는 빌드할 때 값이 박히므로, 쓰지 않는 쪽 코드는 번들에서 빠진다.
import { mockApi } from '@/mocks'
import type { Transport } from '@/lib/contracts'
import { realApi } from './real'
import type { Api } from './types'

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === '1'

export const api: Api = USE_MOCKS ? mockApi : realApi

// 경로 API(POST /api/legs)가 계산해 주는 이동수단. 실제 서버는 지금 보행(walk)만 지원하고, 보행 아닌 요청이 하나라도 섞이면
// 배치 전체를 422로 거절한다(이동주 PR #7). 그래서 화면은 지원하는 이동수단만 보내고, 나머지는 "아직 지원하지 않아요"로 보여 준다.
// 서버가 car·taxi·bus 를 지원하면 여기에 더한다. 목업은 모두 지원한다
export const SUPPORTED_LEG_MODES: readonly Transport[] = USE_MOCKS ? ['walk', 'car', 'taxi', 'bus'] : ['walk']

export { ApiRequestError, isApiError } from './http'
export type { Api, PlaceQuery, SignInInput, SignUpInput } from './types'
