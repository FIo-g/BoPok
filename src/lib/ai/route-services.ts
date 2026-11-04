import 'server-only'
import { placeKindOf, type Coord, type FoodTag, type PlaceDetail, type PlaceRecommendationRequest, type PlaceRecommendationResponse } from '@/lib/contracts'
import { straightLineDistanceM } from '@/lib/geo/straight-line'
import type { DraftStop } from './stops'

type Recommend = (input: PlaceRecommendationRequest) => Promise<PlaceRecommendationResponse>
function serviceKind(name: string): 'restaurant' | 'cafe' | 'lodging' | null {
  // 이름 전체가 명시적인 빈 자리일 때만 채운다. '아침 산책' 같은 활동은 보존한다.
  const label = name.replace(/\s+/g, '')
  if (/^(?:(?:숙박|숙소|호텔)(?:장소)?(?:선택|체크인)?|체크인)$/.test(label)) return 'lodging'
  if (/^(?:카페|커피)(?:휴식|장소)?(?:선택)?$/.test(label)) return 'cafe'
  if (/^(?:식사|(?:아침|점심|저녁|조식|중식|석식)(?:식사)?)(?:장소)?(?:선택)?$/.test(label)) return 'restaurant'
  return null
}

// AI가 만든 빈 식사 자리만 DB 장소로 채운다. 직접 고른 장소·예약·꼭 갈 곳은 건드리지 않는다.
export async function fillRouteServices(drafts: DraftStop[], options: {
  details: PlaceDetail[]; transport: 'car' | 'transit' | 'taxi'; overnightDays?: number[]; avoidStairs?: boolean; avoidFoodTags?: FoodTag[];
}, recommend?: Recommend): Promise<DraftStop[]> {
  if (!recommend) return drafts
  const byId = new Map(options.details.map(place => [place.id, place]))
  const out = drafts.map(draft => ({ ...draft }))
  for (const day of options.overnightDays ?? []) {
    const existing = out.some(draft => (draft.day ?? 1) === day &&
      (draft.placeId ? byId.get(draft.placeId)?.kind === 'lodging' : serviceKind(draft.name) === 'lodging'))
    if (existing) continue
    const last = out.findLastIndex(draft => (draft.day ?? 1) === day)
    if (last >= 0) out.splice(last + 1, 0, { placeId: null, name: '숙박 장소 선택', day, seated: true })
  }
  const used = new Set(out.flatMap(draft => draft.placeId ? [draft.placeId] : []))
  const maxDistanceM = options.transport === 'transit' ? 1500 : 5000
  const deadline = Date.now() + 4000
  const coordOf = (draft: DraftStop): Coord | undefined => draft.coord ?? (draft.placeId ? byId.get(draft.placeId)?.coord : undefined)
  for (let index = 0; index < out.length && Date.now() < deadline; index++) {
    const draft = out[index]
    if (draft.placeId || draft.mustVisit || draft.reservedAt || draft.coord) continue
    const kind = serviceKind(draft.name)
    if (!kind) continue
    const day = draft.day ?? 1
    const previous = out.slice(0, index).findLast(item => (item.day ?? 1) === day && coordOf(item))
    const next = out.slice(index + 1).find(item => (item.day ?? 1) === day && coordOf(item))
    const from = previous ? coordOf(previous) : undefined
    const to = next ? coordOf(next) : undefined
    const near = from ?? to
    if (!near) continue
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        recommend({ kind, near, ...(from && to ? { route: [from, to] } : {}),
          query: '', limit: 5, avoidStairs: options.avoidStairs }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())) }),
      ])
      const choice = result?.items.find(item => placeKindOf(item.place) === kind && !used.has(item.place.id) &&
        !item.menus.some(menu => menu.foodTags.some(tag => options.avoidFoodTags?.includes(tag))) &&
        (item.distanceM ?? straightLineDistanceM(near, item.place.coord)) <= maxDistanceM &&
        (item.straightLineDetourM === undefined || item.straightLineDetourM <= maxDistanceM))
      if (!choice) continue
      out[index] = { ...draft, placeId: choice.place.id, name: choice.place.name, coord: choice.place.coord,
        seated: choice.place.seated, ...(draft.visitMin === undefined && choice.place.visitMin !== undefined ? { visitMin: choice.place.visitMin } : {}) }
      used.add(choice.place.id)
    } catch {
      // 영업·가격·좌석·접근성은 추정하지 않는다. 가까운 후보가 없거나 조회에 실패하면 빈 자리를 유지한다.
    } finally { if (timer) clearTimeout(timer) }
  }
  return out
}
