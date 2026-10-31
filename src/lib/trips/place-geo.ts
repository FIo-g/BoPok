// 장소·경로를 가져오는 지점. 실제 함수는 이동주 담당(src/lib/places의 getPlaceDetails,
// src/lib/geo의 getLegs)이라 여기서는 부르기만 하고 고치지 않는다 (AGENTS.md 3·4장).
//
// 판정이 멈추지 않게, 받지 못한 것은 '없음'으로 돌려준다 — 가짜 거리·시간으로 채우지 않는다.
// 엔진이 모르는 장소는 '정보 없음', 빠진 경로는 missingLegs로 처리한다 (설계 7.3 6·7번).
import 'server-only'
import type { Leg, LegRequest, PlaceDetail } from '@/lib/contracts'
import { PlaceIdInputSchema } from '@/lib/contracts'
import { GeoError } from '@/lib/geo/errors'
import { getLegs } from '@/lib/geo/legs'
import { getPlaceDetails } from '@/lib/places'

export type PlaceGeoDeps = {
  getPlaceDetails(ids: string[]): Promise<PlaceDetail[]>
  getLegs(requests: LegRequest[]): Promise<Leg[]>
}

const DETAILS_PER_CALL = 100 // getPlaceDetails 한 번에 받는 상한
const LEGS_PER_CALL = 20 // getLegs 한 번에 받는 상한

function chunks<T>(items: T[], size: number): T[][] {
  const parts: T[][] = []
  for (let start = 0; start < items.length; start += size) parts.push(items.slice(start, start + size))
  return parts
}

// source는 실제 함수(또는 테스트의 가짜). 위 약속을 지키는 얇은 껍데기를 만든다.
export function createPlaceGeoDeps(source: PlaceGeoDeps): PlaceGeoDeps {
  return {
    async getPlaceDetails(ids) {
      // 형식이 틀린 id는 DB에 있을 수 없다. 하나 때문에 조회 전체가 실패하지 않게 뺀다.
      const valid = [...new Set(ids)].filter(id => PlaceIdInputSchema.safeParse(id).success)
      const details: PlaceDetail[] = []
      for (const part of chunks(valid, DETAILS_PER_CALL)) details.push(...(await source.getPlaceDetails(part)))
      return details
    },
    async getLegs(requests) {
      const legs: Leg[] = []
      for (const part of chunks(requests, LEGS_PER_CALL)) {
        try {
          legs.push(...(await source.getLegs(part)))
        } catch (error) {
          // getLegs는 한 묶음에서 하나도 못 받으면 첫 실패를 던진다. 그 묶음은 '경로 없음'으로 두고
          // 판정을 잇는다 (엔진이 missingLegs로 알려 준다). DB 오류 같은 내부 오류는 숨기지 않는다.
          if (!(error instanceof GeoError)) throw error
          // 버스는 아직 지원하지 않는 게 정상이라 로그를 남기지 않는다. 키·원문 없이 종류만 남긴다.
          if (error.kind !== 'unsupported_mode') console.error('[acct] 경로를 받지 못해 빈 값으로 판정', error.kind)
        }
      }
      return legs
    },
  }
}

const realDeps = createPlaceGeoDeps({
  getPlaceDetails: ids => getPlaceDetails(ids),
  getLegs: requests => getLegs(requests),
})

export function getPlaceGeoDeps(): PlaceGeoDeps {
  return realDeps
}
