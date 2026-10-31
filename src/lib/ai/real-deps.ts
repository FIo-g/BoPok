// AI 연결 지점(AiDeps)을 실제 계정·여행·장소·경로 함수로 채운다. 모든 AI 라우트는 getAiDeps()만 부른다.
// 개발용 가짜(dev-deps.ts)는 테스트에서만 쓴다 — 이 파일은 dev-deps를 import하지 않는다.
// (가짜 로그인 헤더로 로그인 없이 들어오는 길이 실제 실행에 남지 않게 하려는 것이다. routes.test.ts가 지킨다.)
import 'server-only'
import { getLegsPartial } from '@/lib/geo/legs'
import {
  createVersion,
  getOpinions,
  getTripContext,
  interviews,
  requireTripMember,
  saveTravelers,
} from '@/lib/trips'
import { callJson } from './client'
import type { AiDeps } from './deps'
import { createLegsAdapter, createPlaceAdapters, createPlaceDetailsAdapter } from './place-adapters'

// overrides는 테스트에서 일부만 바꿔 끼울 때 쓴다 (예: 진짜 DB는 두고 callJson만 가짜로).
export function createRealDeps(overrides: Partial<AiDeps> = {}): AiDeps {
  return {
    // 로그인 안 하면 401, 그 여행의 그룹 구성원이 아니면 403 (김경선). 없는 여행도 403이다.
    requireTripMember: (request, tripId) => requireTripMember(request, tripId),
    // 함수 인자 끝의 db(테스트용)가 새어 들어가지 않게 화살표로 감싼다.
    getTripContext: tripId => getTripContext(tripId),
    getOpinions: versionId => getOpinions(versionId),
    createVersion: (tripId, input) => createVersion(tripId, input),
    saveTravelers: (tripId, travelers) => saveTravelers(tripId, travelers),
    interviews: {
      get: tripId => interviews.get(tripId),
      save: (tripId, state) => interviews.save(tripId, state),
    },
    // 이동주: 장소 조회와 경로. 후보 검색·이름 맞추기·POI는 아직 없어 어댑터가 채운다.
    ...createPlaceAdapters(),
    getPlaceDetails: createPlaceDetailsAdapter(),
    getLegs: createLegsAdapter(getLegsPartial),
    callJson,
    ...overrides,
  }
}

// 상태가 없는 함수 묶음이라 한 번 만들어 계속 쓴다.
let shared: AiDeps | undefined

export function getAiDeps(): AiDeps {
  shared ??= createRealDeps()
  return shared
}
