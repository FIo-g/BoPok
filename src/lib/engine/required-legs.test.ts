import { describe, expect, it } from 'vitest'
import { legKey, type Stop } from '@/lib/contracts'
import { requiredLegs } from './required-legs'
import { places } from './test-fixtures'

function makeStop(key: string, placeId: string | null, over: Partial<Stop> = {}): Stop {
  const place = placeId ? places[placeId] : undefined
  return {
    key,
    placeId,
    name: place?.name ?? '점심',
    mustVisit: false,
    arriveBy: 'car',
    skipSegmentIds: [],
    detourMap: {},
    restNodeIds: [],
    ...over,
  }
}

// legKey는 placeId·nodeId가 있으면 좌표를 쓰지 않는다.
function key(fromPlaceId: string, fromNodeId: string, toPlaceId: string, toNodeId: string): string {
  return legKey({
    from: { placeId: fromPlaceId, nodeId: fromNodeId, coord: [0, 0] },
    to: { placeId: toPlaceId, nodeId: toNodeId, coord: [0, 0] },
    mode: 'car',
  })
}

describe('requiredLegs', () => {
  it('requiredLegs: 같은 경로는 한 번', () => {
    const legs = requiredLegs(
      [
        makeStop('k1', 'hanbat'),
        makeStop('k2', 'science'),
        makeStop('k3', 'hanbat'),
        makeStop('k4', 'science'),
      ],
      places,
    )
    expect(legs.map(legKey)).toEqual([
      key('hanbat', 'P', 'science', 'P2'),
      key('science', 'P2', 'hanbat', 'P'),
    ])
  })

  it('requiredLegs: 좌표 없는 경로는 빠짐', () => {
    const legs = requiredLegs(
      [
        makeStop('k1', 'hanbat'),
        makeStop('k2', null, { name: '점심', arriveBy: 'walk' }),
        makeStop('k3', 'hanbat', { arriveBy: 'walk' }),
      ],
      places,
    )
    expect(legs).toEqual([])
  })
})
