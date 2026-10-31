// 확정 일정 공유 글. 형식은 역할 문서의 '공유 글'과 화면 목업(src/mocks/share-text.ts)을 따른다 —
// 장소 순서·시간, 장소별 걷는 시간, 쉼터, 탈것 구간, 하루 요약, 연락처, "출발 전 운영 여부 확인".
//
// 숫자는 engine.judge 결과에서만 가져온다 (AGENTS.md 6장). 정보가 없으면 '정보 부족'으로 쓰고
// 0분 같은 값을 지어내지 않는다. DB를 쓰지 않는 순수 함수라 테스트하기 쉽다.
import type { Trip, TripVersion } from '@/lib/contracts'
import { formatRange } from '@/lib/engine'
import type { JudgeRun } from './judge-run'

const MODE_TEXT = { walk: '걸어서', car: '자가용', taxi: '택시', bus: '버스' } as const

const REST_TYPE_TEXT = { indoor: '(실내)', outdoor: '(야외)' } as const

export function buildShareText(args: { trip: Trip; version: TripVersion; run: JudgeRun }): string {
  const { trip, version, run } = args
  const result = run.result

  const lines: string[] = [`[보폭] ${trip.title}`, trip.date ? `${trip.date} 확정 일정` : '확정 일정', '']

  version.stops.forEach((stop, index) => {
    const stopResult = result?.stops.find(one => one.stopKey === stop.key)
    const head = [stop.startTime, stop.name].filter(Boolean).join(' ')
    const details: string[] = []

    if (stop.reservedAt) details.push(`예약 ${stop.reservedAt}`)
    // 걷는 시간은 장소 안 길 정보가 있을 때만. 없으면 숫자를 비워 둔다
    if (stopResult?.known) details.push(`걷기 ${formatRange(stopResult.walk)} · 추정치`)
    else details.push('길 정보 없음')

    // 쉬기로 한 쉼터와 그 종류 (실내·야외). 장소 정보가 없으면 줄을 넣지 않는다
    const place = stop.placeId ? run.places[stop.placeId] : undefined
    for (const nodeId of stop.restNodeIds) {
      const node = place?.nodes.find(one => one.id === nodeId)
      if (node) details.push(`${node.name}${node.restType ? REST_TYPE_TEXT[node.restType] : ''}에서 쉬기`)
    }

    lines.push(head, `  ${details.join(' · ')}`)

    // 탈것으로 이동하는 구간 (걷기는 장소별 걷는 시간에 이미 들어 있다)
    const leg = result?.legs.find(one => one.fromStopKey === stop.key)
    const next = version.stops[index + 1]
    if (leg && next && leg.mode !== 'walk') {
      const ride = leg.rideMin !== null ? ` 약 ${Math.round(leg.rideMin)}분` : ''
      lines.push(`  ↓ ${MODE_TEXT[leg.mode]} 이동${ride}`)
    }
  })

  lines.push('', daySummary(run))

  // 연락처 — 전화번호가 있는 장소만
  const contacts = version.stops
    .map(stop => (stop.placeId ? run.places[stop.placeId] : undefined))
    .filter((place): place is NonNullable<typeof place> => Boolean(place?.phone))
    .map(place => `${place.name} ${place.phone}`)
  if (contacts.length > 0) lines.push('', ...contacts)

  lines.push('', '출발 전 운영 여부를 꼭 확인하세요')
  return lines.join('\n')
}

// 하루 요약. 걷는 시간을 하나도 모르면 '0분'이라고 쓰지 않고 정보가 없다고 밝힌다.
function daySummary(run: JudgeRun): string {
  const result = run.result
  if (!result) return '하루 걷기 정보 부족 (함께 가는 사람을 입력하면 알려드려요)'

  const knowsWalk = result.stops.some(one => one.known) || result.legs.some(one => one.walkTime !== null)
  if (!knowsWalk) return '하루 걷기 정보 부족 (장소 정보가 모이면 알려드려요)'

  const day = `하루 걷기 ${formatRange(result.day)} · 쉬지 않고 걷는 시간 최대 ${formatRange(result.longest)} (추정치)`
  // 경로를 받지 못한 이동은 위 시간에 들어 있지 않다. 숫자가 실제보다 작게 읽히지 않게 밝힌다 (설계 7.3 7번).
  if (result.missingLegs.length === 0) return day
  return `${day}\n(경로 정보를 받지 못한 이동 ${result.missingLegs.length}곳은 걷는 시간에 넣지 않았어요)`
}
