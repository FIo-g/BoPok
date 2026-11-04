import 'server-only'
import { z } from 'zod'

export const DAEJEON_TAXI_FARE_SOURCE = 'https://www.daejeon.go.kr/drh/board/boardNormalView.do?boardId=normal_0189&menuSeq=6825&ntatcSeq=1525249286'

export function estimateDaejeonTaxiFare(input: unknown) {
  const request = z.object({ distanceM: z.number().finite().nonnegative().max(1000000),
    slowSeconds: z.number().finite().nonnegative().optional(),
  }).strict().parse(input)
  // 대전 중형택시 2026-11-01 시행: 1.65km 4,800원, 이후 125m당 100원·저속 29초당 100원.
  const distanceFare = 4800 + Math.ceil(Math.max(0, request.distanceM - 1650) / 125) * 100
  const fareKrw = distanceFare + (request.slowSeconds === undefined ? 0 : Math.ceil(request.slowSeconds / 29) * 100)
  return { fareKrw, basis: request.slowSeconds === undefined ? 'distance_only' as const : 'distance_and_slow_time' as const,
    source: DAEJEON_TAXI_FARE_SOURCE, checkedAt: '2026-11-03', effectiveFrom: '2026-11-01',
    exclusions: ['심야·시외 할증', '통행료', ...(request.slowSeconds === undefined ? ['정체·저속 시간 요금'] : [])] }
}
