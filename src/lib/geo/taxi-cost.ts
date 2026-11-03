import 'server-only'
import { TaxiCostRequestSchema, TaxiCostResponseSchema, type Leg, type LegRequest, type PlaceDetail } from '@/lib/contracts'
import { getPlaceDetails } from '@/lib/places'
import { getLegs } from './legs'
import { estimateDaejeonTaxiFare } from './taxi-fare'
import { GeoError } from './errors'

export async function quoteTaxiCosts(value: unknown, dependencies: {
  details?: (ids: string[]) => Promise<PlaceDetail[]>; route?: (requests: LegRequest[]) => Promise<Leg[]>
} = {}) {
  const { requests } = TaxiCostRequestSchema.parse(value)
  if (!requests.length) return []
  const ids = [...new Set(requests.flatMap(request => [request.from.placeId!, request.to.placeId!]))]
  const details = await (dependencies.details ?? getPlaceDetails)(ids)
  const places = new Map(details.map(place => [place.id, place]))
  for (const request of requests) for (const end of [request.from, request.to]) {
    const place = places.get(end.placeId!)
    const coord = end.nodeId ? place?.nodes.find(node => node.id === end.nodeId)?.coord : place?.coord
    if (!place || !/^(?:대전광역시|대전)\s/.test(place.address ?? '') || !coord ||
      coord.some((value, index) => Math.abs(value - end.coord[index]) > 0.00001)) {
      throw new GeoError('invalid_request', '대전 지역의 등록된 장소·지점 좌표로 택시 요금을 요청해 주세요.')
    }
  }
  const legs = await (dependencies.route ?? getLegs)(requests)
  return TaxiCostResponseSchema.parse(legs.map(leg => {
    const quote = estimateDaejeonTaxiFare({ distanceM: leg.distanceM })
    return { key: leg.key, distanceM: leg.distanceM, fareKrw: quote.fareKrw, basis: quote.basis,
      source: quote.source, checkedAt: quote.checkedAt, exclusions: quote.exclusions }
  }))
}
