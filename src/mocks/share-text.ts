// 확정 일정 공유 글(목업). 실제로는 서버(김경선)가 같은 형식으로 만든다 — 장소 순서·시간, 걷는 시간, 쉼터, 탈것 구간,
// 하루 요약, 연락처, "출발 전 운영 여부 확인". 숫자는 엔진 판정 결과에서만 가져온다.
import type { Trip, TripVersion, Traveler } from '@/lib/contracts'
import { formatRange } from '@/lib/engine'
import { judgeWithMocks } from './judge-helper'

const MODE_TEXT = { walk: '걸어서', car: '자가용', taxi: '택시', bus: '버스' } as const

export function buildShareText(trip: Trip, version: TripVersion, travelers: Traveler[]): string {
  const { result, places } = judgeWithMocks(version.stops, travelers)
  const lines: string[] = [`[보폭] ${trip.title}`, trip.date ? `${trip.date} 확정 일정` : '확정 일정', '']
  version.stops.forEach((stop, index) => {
    const stopResult = result.stops.find(s => s.stopKey === stop.key)
    const head = [stop.startTime, stop.name].filter(Boolean).join(' ')
    const details: string[] = []
    if (stop.reservedAt) details.push(`예약 ${stop.reservedAt}`)
    if (stopResult?.known) details.push(`걷기 ${formatRange(stopResult.walk)} · 추정치`)
    else details.push('길 정보 없음')
    const place = stop.placeId ? places[stop.placeId] : undefined
    for (const nodeId of stop.restNodeIds) {
      const node = place?.nodes.find(n => n.id === nodeId)
      if (node) details.push(`${node.name}${node.restType === 'indoor' ? '(실내)' : node.restType === 'outdoor' ? '(야외)' : ''}에서 쉬기`)
    }
    lines.push(head, `  ${details.join(' · ')}`)
    const leg = result.legs.find(l => l.fromStopKey === stop.key)
    const next = version.stops[index + 1]
    if (leg && next && leg.mode !== 'walk') {
      lines.push(`  ↓ ${MODE_TEXT[leg.mode]} 이동${leg.rideMin !== null ? ` 약 ${Math.round(leg.rideMin)}분` : ''}`)
    }
  })
  lines.push('', `하루 걷기 ${formatRange(result.day)} · 쉬지 않고 걷는 시간 최대 ${formatRange(result.longest)} (추정치)`)
  const contacts = version.stops
    .map(stop => (stop.placeId ? places[stop.placeId] : undefined))
    .filter((place): place is NonNullable<typeof place> => Boolean(place?.phone))
    .map(place => `${place.name} ${place.phone}`)
  if (contacts.length > 0) lines.push('', ...contacts)
  lines.push('', '출발 전 운영 여부를 꼭 확인하세요')
  return lines.join('\n')
}
