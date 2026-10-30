// 의견 반영 다시 짜기 (설계 6.4·7.1.1). AI는 장소 고르기·순서·시간과 반영한 의견 id만 정한다.
// 걷는 시간·거리·계단 수는 AI에게 계산시키지 않고, 위반은 엔진 문장 그대로 다시 묻는다.
// 꼭 갈 곳·예약은 AI가 빼도 되돌려 넣는다. 의견이 부딪히면 [부모님]을 따른다.
import 'server-only'
import { z } from 'zod'
import {
  nonNegative,
  ReviseRequestSchema,
  ReviseResponseSchema,
  TimeSchema,
  type PlaceSummary,
  type Reaction,
  type Stop,
} from '@/lib/contracts'
import { groupProfile } from '@/lib/engine'
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { HttpError, handle, readJson, requireVersionInTrip } from './http'
import { planJudgeSave, type PlanAttempt, type PlanAttemptResult } from './plan-and-save'
import { enforceMustStops, restoreMustStops, samePlaceName, type DraftStop } from './stops'
import { hasNumberOrStairsClaim, sanitizePromptText } from './text-guard'

// AI가 돌려줄 모양. 걷는 시간·거리·계단 칸은 두지 않고 (엔진이 계산한다),
// 꼭 갈 곳·예약 표시도 받지 않는다 — 원래 버전에서만 가져온다 (설계 6.4).
const AiReviseSchema = z.object({
  stops: z.array(
    z.object({
      placeId: z.string().nullable(),
      name: z.string().trim().min(1).max(100),
      startTime: TimeSchema.optional(),
      visitMin: nonNegative.optional(),
      seated: z.boolean().optional(),
    }),
  ),
  appliedOpinionIds: z.array(z.string()),
  note: z.string().max(500).optional(),
})

const SYSTEM_PROMPT =
  '가족 여행 일정을 의견에 맞게 다시 짠다. 후보 목록의 id로만 골라라. 식사 자리는 placeId null + 이름으로 넣는다. ' +
  '꼭 갈 곳·예약된 장소는 손대지 마라(이미 정해진 표시를 그대로 쓴다). 의견이 서로 부딪히면 [부모님] 의견을 따르라(부모님을 위한 서비스). ' +
  '반영한 의견 id를 appliedOpinionIds에 넣어라. 걷는 시간·거리·계단 수는 쓰지 마라. ' +
  '반드시 JSON으로만 답하라. 모양: {"stops":[{"placeId":"장소 id 또는 null","name":"장소 이름","startTime":"HH:mm","visitMin":60,"seated":false}],"appliedOpinionIds":["의견 id"],"note":"한 줄 메모"}'

// 반응 버튼 문구 (프론트 표시와 같은 말로 AI에게 보여준다)
const REACTION_LABEL: Record<Reaction, string> = {
  too_far: '너무 멀어요',
  stairs_worry: '계단이 걱정돼요',
  must_go: '꼭 가고 싶어요',
  need_rest: '쉬는 곳이 더 있었으면',
  prefer_other: '다른 곳이 좋겠어요',
}

function candidateLine(place: PlaceSummary): string {
  const parts = [`id: ${place.id}`, `이름: ${place.name}`, `분류: ${place.category}`]
  if (place.styles.length > 0) parts.push(`스타일: ${place.styles.join(', ')}`)
  parts.push(place.visitMin !== undefined ? `머무는 시간 약 ${place.visitMin}분` : '머무는 시간 미정')
  parts.push(place.seated ? '앉는 곳' : '앉는 곳 아님')
  parts.push(place.indoor ? '실내' : '실외')
  return `- ${parts.join(', ')}`
}

function scheduleLine(stop: Stop): string {
  const parts = [`이름: ${sanitizePromptText(stop.name)}`, `id: ${stop.placeId ?? '없음'}`]
  if (stop.startTime !== undefined) parts.push(`시간 ${stop.startTime}`)
  if (stop.mustVisit) parts.push('꼭 갈 곳')
  if (stop.reservedAt !== undefined) parts.push(`예약 ${stop.reservedAt}`)
  return `- ${parts.join(', ')}`
}

// 목록 밖 placeId는 버린다. 식사 자리(null)는 이름이 있을 때만 둔다.
function filterDrafts(
  stops: z.infer<typeof AiReviseSchema>['stops'],
  candidates: PlaceSummary[],
): DraftStop[] {
  const ids = new Set(candidates.map(candidate => candidate.id))
  const drafts: DraftStop[] = []
  for (const stop of stops) {
    if (stop.placeId !== null && !ids.has(stop.placeId)) continue
    drafts.push({
      placeId: stop.placeId,
      name: stop.name,
      ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
      ...(stop.visitMin !== undefined ? { visitMin: stop.visitMin } : {}),
      ...(stop.seated !== undefined ? { seated: stop.seated } : {}),
    })
  }
  return drafts
}

// 원래 버전의 꼭 갈 곳·예약 stop. 빠지면 되돌려 넣을 때 쓰는 원래 값이다.
function mustDraftsOf(versionStops: Stop[]): DraftStop[] {
  return versionStops
    .filter(stop => stop.mustVisit || stop.reservedAt !== undefined)
    .map(stop => ({
      placeId: stop.placeId,
      name: stop.name,
      mustVisit: stop.mustVisit,
      ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
      ...(stop.reservedAt !== undefined ? { reservedAt: stop.reservedAt } : {}),
      ...(stop.coord !== undefined ? { coord: stop.coord } : {}),
      ...(stop.visitMin !== undefined ? { visitMin: stop.visitMin } : {}),
      ...(stop.seated !== undefined ? { seated: stop.seated } : {}),
      skipSegmentIds: [...stop.skipSegmentIds],
      detourMap: { ...stop.detourMap },
      restNodeIds: [...stop.restNodeIds],
    }))
}

// 원래 일정의 stop과 초안이 같은 곳인지 본다 (stops.ts의 짝짓기와 같은 규칙).
function matchesOriginal(stop: Stop, draft: DraftStop): boolean {
  if (stop.placeId !== null && draft.placeId !== null) {
    if (stop.placeId === draft.placeId) return true
    return samePlaceName(stop.name, draft.name)
  }
  return samePlaceName(stop.name, draft.name)
}

// placeId 이름은 후보·원래 일정의 DB 이름으로 덮어쓰고,
// 그대로 남은 장소는 원래 stop의 좌표·머무는 시간·앉는 표시·우회로·빼기·쉼터 설정을 옮긴다 (설계 6.4).
// 머무는 시간은 원래 값·DB 값 순으로 AI 값보다 우선한다.
function applyNamesAndCarry(drafts: DraftStop[], original: Stop[], candidates: PlaceSummary[]): DraftStop[] {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate] as const))
  const remaining = [...original]
  return drafts.map(draft => {
    const out = { ...draft }
    const candidateVisit = out.placeId !== null ? byId.get(out.placeId)?.visitMin : undefined
    if (out.placeId !== null) {
      out.name = byId.get(out.placeId)?.name ?? out.name
    }
    // 같은 장소를 두 번 들르면 순서대로 짝짓는다.
    const index = remaining.findIndex(stop => matchesOriginal(stop, out))
    if (index < 0) {
      // 원래에 없던 새 장소는 DB visitMin이 있으면 그것이 AI 값보다 우선이다.
      if (out.placeId !== null && candidateVisit !== undefined) out.visitMin = candidateVisit
      return out
    }
    const [found] = remaining.splice(index, 1)
    if (found === undefined) return out
    if (out.placeId !== null) {
      out.name = byId.get(out.placeId)?.name ?? found.name
    } else {
      // null 자리는 원래 이름으로 되돌린다 (붙여넣기 다듬기 이름 유지).
      out.name = found.name
    }
    // 원래 값이 있으면 그대로, 없으면 DB 값, 그래도 없으면 AI 값을 둔다.
    const carriedVisit = found.visitMin ?? candidateVisit ?? out.visitMin
    return {
      ...out,
      ...(found.coord !== undefined ? { coord: found.coord } : {}),
      ...(carriedVisit !== undefined ? { visitMin: carriedVisit } : {}),
      ...(found.seated !== undefined ? { seated: found.seated } : {}),
      skipSegmentIds: [...found.skipSegmentIds],
      detourMap: { ...found.detourMap },
      restNodeIds: [...found.restNodeIds],
    }
  })
}

// null 자리 걸러내기 — 원래 일정의 null 자리와 이름이 같으면 살리고,
// 그 밖은 앉는 자리이고 숫자·계단 약속이 없을 때만 둔다 (설계 6.4).
function filterNullDrafts(drafts: DraftStop[], original: Stop[]): DraftStop[] {
  const remainingNull = original.filter(stop => stop.placeId === null)
  const out: DraftStop[] = []
  for (const draft of drafts) {
    if (draft.placeId !== null) {
      out.push(draft)
      continue
    }
    // 같은 원래 자리를 두 번 짝짓지 않게 쓴 자리는 버린다
    const at = remainingNull.findIndex(base => samePlaceName(base.name, draft.name))
    if (at >= 0) {
      remainingNull.splice(at, 1)
      out.push(draft)
      continue
    }
    if (draft.seated === true && !hasNumberOrStairsClaim(draft.name)) {
      out.push(draft)
    }
  }
  return out
}

// 의견 한 줄을 프롬프트에 넣기 전 공용 정리로 대괄호를 지운다.
// 다른 사람이 '[부모님]' 표시를 흉내 내지 못하게 한다 (설계 6.4).
function sanitizeOpinionText(text: string): string {
  return sanitizePromptText(text)
}

export async function handleRevise(
  request: Request,
  deps: AiDeps,
  opts?: { now?: () => number },
): Promise<Response> {
  return handle(
    async () => {
      const nowFn = opts?.now ?? Date.now
      const deadlineAt = nowFn() + 50000
      const deadlineMs = (): number => Math.max(1, deadlineAt - nowFn())
      const shouldTrySecond = (): boolean => deadlineAt - nowFn() >= 15000
      const input = await readJson(request, ReviseRequestSchema)
      const session = await deps.requireTripMember(request, input.tripId)
      const ctx = await deps.getTripContext(input.tripId)

      // 그 여행의 버전이 맞는지 확인한다 — 다른 그룹 버전 id로 의견이 새는 것을 막는다
      const version = requireVersionInTrip(ctx, input.versionId)
      if (ctx.travelers.length === 0) {
        throw new HttpError(400, 'invalid_request', '함께 가는 분 정보를 먼저 채워 주세요')
      }

      const opinions = await deps.getOpinions(input.versionId)
      const pending = opinions.filter(opinion => opinion.appliedInVersionId == null)
      if (pending.length === 0) {
        throw new HttpError(400, 'invalid_request', '반영할 의견이 없어요')
      }
      const validIds = new Set(pending.map(opinion => opinion.id))

      // 부모님 계정으로 쓴 의견에만 [부모님]을 붙인다 (설계 7.1.1: 부모님을 위한 서비스)
      const parentUserIds = new Set(
        ctx.travelers.filter(traveler => traveler.isParent && traveler.userId !== undefined).map(t => t.userId as string),
      )
      const stopNameOf = (stopKey: string | null): string =>
        stopKey === null
          ? '일정 전체'
          : (version.stops.find(stop => stop.key === stopKey)?.name ?? '일정 전체')
      const opinionLines = pending.map(opinion => {
        const bits = [`반응: ${opinion.reactions.map(reaction => REACTION_LABEL[reaction]).join(', ') || '없음'}`]
        if (opinion.comment) bits.push(`한 줄: ${JSON.stringify(sanitizeOpinionText(opinion.comment))}`)
        const marker = parentUserIds.has(opinion.userId) ? '[부모님] ' : ''
        return `- [${sanitizeOpinionText(stopNameOf(opinion.stopKey))}] ${marker}${bits.join(', ')} (id: ${opinion.id})`
      })

      const profile = groupProfile(ctx.travelers)
      const interview = await deps.interviews.get(input.tripId)
      const transport = interview?.filled.transport ?? 'car'

      const candidates = await deps.searchCandidates({
        styles: interview?.filled.styles ?? [],
        ...(interview?.filled.budget !== undefined ? { budget: interview.filled.budget } : {}),
        // 장소 사이 이동수단 고르기용이라 대중교통은 버스로 찾는다 (설계 7.3.1)
        transport: transport === 'transit' ? 'bus' : transport,
        avoidStairs: profile.condition.avoidStairs,
        limit: 30,
      })

      // 꼭 갈 곳은 후보에 없으면 목록에 더해 AI가 고를 수 있게 한다
      for (const must of interview?.filled.mustVisit ?? []) {
        const found = await deps.matchPlaceByName(must.name)
        if (found && !candidates.some(candidate => candidate.id === found.id)) {
          candidates.push(found)
        }
      }
      const musts = mustDraftsOf(version.stops)
      // 시간 없는 missing을 원래 자리(앞 stop 바로 뒤)에 넣기 위한 원래 일정 순서.
      const originalOrder: DraftStop[] = version.stops.map(stop => ({
        placeId: stop.placeId,
        name: stop.name,
        ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
        ...(stop.reservedAt !== undefined ? { reservedAt: stop.reservedAt } : {}),
      }))
      const missingPlaceIds = [
        ...new Set(
          musts
            .filter(must => must.placeId !== null && !candidates.some(candidate => candidate.id === must.placeId))
            .map(must => must.placeId as string),
        ),
      ]
      if (missingPlaceIds.length > 0) {
        for (const detail of await deps.getPlaceDetails(missingPlaceIds)) {
          if (!candidates.some(candidate => candidate.id === detail.id)) {
            candidates.push(detail)
          }
        }
      }

      const scheduleText = version.stops.map(scheduleLine).join('\n')
      const baseUser =
        `현재 일정:\n${scheduleText}\n\n` +
        `가족 의견:\n${opinionLines.join('\n')}\n\n` +
        `후보 장소 목록:\n${candidates.map(candidateLine).join('\n')}\n` +
        '위 의견을 반영해 일정을 다시 짜라.'

      // AI가 돌려준 한 줄 메모·반영 id는 저장된 시도의 것으로 쓴다 — planJudgeSave가 고른 시도의 메타를 돌려준다.
      const args: {
        tripId: string
        travelers: typeof ctx.travelers
        transport: 'car' | 'transit' | 'taxi'
        attempt: PlanAttempt
        parentId: string | null
        originalStops: Stop[]
        shouldTrySecond: () => boolean
      } = {
        tripId: input.tripId,
        travelers: ctx.travelers,
        transport,
        originalStops: version.stops,
        shouldTrySecond,
        attempt: async feedback => {
          const withFeedback =
            feedback === null
              ? baseUser
              : `${baseUser}\n앞 일정은 이런 이유로 부모님 조건을 넘었다:\n${feedback}\n덜 걷게 다시 골라라.`
          const callOnce = async (
            mustWarning: string | null,
          ): Promise<PlanAttemptResult & { missing: DraftStop[] }> => {
            const user = mustWarning === null ? withFeedback : `${withFeedback}\n${mustWarning}`
            const parsed = await deps.callJson(
              {
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user', content: user },
                ],
                schema: AiReviseSchema,
              },
              { deadlineMs: deadlineMs() },
            )
            // 메모에 숫자·계단 약속이 있으면 버린다 — 숫자는 엔진에서만 나온다 (설계 6.4).
            const note =
              parsed.note !== undefined && !hasNumberOrStairsClaim(parsed.note) ? parsed.note : undefined
            // 목록에 없는 의견 id는 버리고 중복을 없앤다.
            const appliedOpinionIds = [...new Set(parsed.appliedOpinionIds.filter(id => validIds.has(id)))]
            const idFiltered = filterDrafts(parsed.stops, candidates)
            // 꼭 갈 곳을 되돌려 넣기 전 걸러진 초안이 비면 AI 실패로 본다 (설계 6.4).
            if (idFiltered.length === 0) {
              throw new AiCallError('invalid_output', 'AI가 고른 장소가 없어요')
            }
            const nullFiltered = filterNullDrafts(idFiltered, version.stops)
            if (nullFiltered.length === 0) {
              throw new AiCallError('invalid_output', 'AI가 고른 장소가 없어요')
            }
            const named = applyNamesAndCarry(nullFiltered, version.stops, candidates)
            if (named.length === 0) {
              throw new AiCallError('invalid_output', 'AI가 고른 장소가 없어요')
            }
            const { drafts, missing } = enforceMustStops(named, musts)
            return { drafts, missing, ...(note !== undefined ? { note } : {}), appliedOpinionIds }
          }
          const first = await callOnce(null)
          if (first.missing.length === 0) {
            return {
              drafts: first.drafts,
              ...(first.note !== undefined ? { note: first.note } : {}),
              appliedOpinionIds: first.appliedOpinionIds,
            }
          }
          // 꼭 갈 곳이 빠졌으면 같은 초안 안에서 한 번만 다시 묻는다.
          const warning = `꼭 갈 곳 ${first.missing.map(must => must.name).join(', ')}를 빼거나 바꾸면 안 된다. 원래 자리·시간 그대로 넣어라.`
          const second = await callOnce(warning)
          // 그래도 빠지면 예약 시간 순서에 맞는 자리에 되돌려 넣는다 (맨 뒤가 아님, 중복 없음).
          const restored = restoreMustStops(second.drafts, second.missing, originalOrder)
          const note = second.note ?? first.note
          return {
            drafts: restored,
            ...(note !== undefined ? { note } : {}),
            appliedOpinionIds: second.appliedOpinionIds,
          }
        },
        parentId: version.id,
      }

      // 다시 짜기를 누른 사람을 버전 만든 사람으로 남긴다
      const savingDeps: AiDeps = {
        ...deps,
        createVersion: (async (tripId: string, createInput: Parameters<AiDeps['createVersion']>[1]) =>
          deps.createVersion(tripId, { ...createInput, madeByUserId: session.userId })) as AiDeps['createVersion'],
      }

      const {
        version: next,
        summary,
        appliedOpinionIds,
      } = await planJudgeSave(args, savingDeps)
      return ReviseResponseSchema.parse({ version: next, summary, appliedOpinionIds: appliedOpinionIds ?? [] })
    },
    { aiFallback: 'retry_or_pick' },
  )
}
