// 화면은 이 파일의 api 만 부른다. NEXT_PUBLIC_USE_MOCKS=1 이면 src/mocks 의 가짜 데이터, 아니면 실제 서버 API.
// 환경 변수는 빌드할 때 값이 박힌다. 목업은 켠 빌드에서만 lazy-mock.ts 가 동적으로 불러오므로, 끈 빌드의 클라이언트 번들에는
// 목업 데이터와 연습용 비밀번호가 들어가지 않는다 (정적으로 가져오면 쓰지 않아도 번들에 남는다). 배포 때는 값을 비우거나 0 으로 "지정"한다 (docs/roles/frontend.md).
import type { Transport } from '@/lib/contracts'
import { lazyMockApi } from './lazy-mock'
import { realApi } from './real'
import type { Api } from './types'

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === '1'

export const api: Api = USE_MOCKS ? lazyMockApi : realApi

// 경로 API(POST /api/legs)가 계산해 주는 이동수단. 실제 서버는 보행(walk)·자동차(car)·택시(taxi)를 지원하고 버스(bus)는 아직 지원하지 않는다.
// 지원하지 않거나 못 받은 경로는 응답에서 빠지고 (하나라도 받으면 200, 하나도 못 받으면 첫 실패의 상태 코드 — src/lib/geo/README.md)
// 버스만 보내면 422다. 그래서 화면(plan-cache.ensureLegs)은 지원하는 이동수단만 한 번에 묶어 보내고(서버 상한 단위로 나눠),
// 응답에 없는 key 는 실패로 보며, 버스는 "아직 지원하지 않아요"로 보여 준다.
// 서버가 bus 를 지원하면 여기에 더한다. 목업은 모두 지원한다
export const SUPPORTED_LEG_MODES: readonly Transport[] = USE_MOCKS ? ['walk', 'car', 'taxi', 'bus'] : ['walk', 'car', 'taxi']

export { ApiRequestError, isApiError } from './http'
export type { Api, PlaceQuery, SignInInput, SignUpInput } from './types'
