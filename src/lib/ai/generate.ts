// 처음부터 일정 짜기 (설계 6.4 B). AI는 장소 고르기·순서·시간만 정한다.
// 걷는 시간·거리·계단 수는 AI에게 계산시키지 않고, 위반은 엔진 문장 그대로 다시 묻는다.
import 'server-only'
import { z } from 'zod'
import {
  GenerateRequestSchema,
  PlanResponseSchema,
  TimeSchema,
  nonNegative,
  type Coord,
  type PlaceSummary,
  type Stop,
  type Traveler,
} from '@/lib/contracts'
import { groupProfile } from '@/lib/engine'
import { tripDayList } from '@/lib/plan/trip-days'
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { HttpError, handle, readJson } from './http'
import { partyNoteLines, readAvoidFoodTags } from './party-notes'
import { readWeatherLine } from './weather-notes'
import { planJudgeSave, type PlanAttempt } from './plan-and-save'
import {
  arrangeDraftsByDay,
  dropTimesOutsideWindow,
  enforceMustStops,
  mustVisitWithinWindow,
  restoreMustStops,
  samePlaceName,
  type DraftStop,
} from './stops'
import { hasDietTalk, hasNumberOrStairsClaim, sanitizePromptText } from './text-guard'

// AI가 돌려줄 모양. 걷는 시간·거리·계단 칸은 두지 않는다 (엔진이 계산한다).
const AiStopsSchema = z.object({
  stops: z.array(
    z.object({
      placeId: z.string().nullable(),
      name: z.string().trim().min(1).max(100),
      // 여러 날 여행에서 몇째 날인지. 이상한 값이 와도 일정 전체를 버리지 않고 앞 장소의 날에 둔다
      day: z.number().int().min(1).optional().catch(undefined),
      startTime: TimeSchema.optional(),
      visitMin: nonNegative.optional(),
      seated: z.boolean().optional(),
    }),
  ),
  note: z.string().max(500).optional(),
})

// 한 번에 AI가 짜는 날 수의 한도. 날마다 3~5곳이라 날이 많으면 응답이 길어져 50초 안에 끝나지 않는다.
// 그 뒤의 날은 비워 두고(날짜 탭은 그대로 보인다) 다시 짜기나 직접 고치기로 채운다.
const GENERATE_DAYS_MAX = 7

// 여러 날일 때 시스템 프롬프트에 붙인다. 하루짜리는 붙이지 않아 지금과 같다.
function multiDayPrompt(dayCount: number): string {
  return (
    `이번 여행은 ${dayCount}일이다. 날마다 출발·귀가 시간 안에 3~5곳을 고르고, stops의 항목마다 몇째 날인지 "day"(1부터 ${dayCount}까지)를 넣어라. ` +
    '같은 장소를 여러 날에 넣지 마라. 시간과 순서는 날마다 따로 정한다.'
  )
}

const SYSTEM_PROMPT =
  '대전 하루 여행 일정을 짠다. 이 목록의 id로만 골라라. 식사 자리는 placeId null + 이름으로 넣는다. ' +
  '출발·귀가 시간 안에 3~5곳을 고른다. 꼭 갈 곳은 반드시 넣고 예약 시간 그대로 둔다. ' +
  '걷는 시간·거리·계단 수는 쓰지 마라. 메모와 식사 자리 이름에 건강·식단 이야기를 쓰지 마라. ' +
  '반드시 JSON으로만 답하라. 모양: {"stops":[{"placeId":"장소 id 또는 null","name":"장소 이름","startTime":"HH:mm","visitMin":60,"seated":false}],"note":"한 줄 메모"}'

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

type MustNeed = { placeId: string | null; name: string; reservedAt?: string; coord?: Coord }

// 빠진 꼭 갈 곳은 예약 시간 순서에 맞는 자리에 넣는다. 표시는 공용 도우미가 원래 값으로 맞춘다 (설계 6.4).
function applyMustVisit(drafts: DraftStop[], musts: MustNeed[]): DraftStop[] {
  const mustDrafts: DraftStop[] = musts.map(must => ({
    placeId: must.placeId,
    name: must.name,
    mustVisit: true,
    ...(must.reservedAt !== undefined ? { reservedAt: must.reservedAt, startTime: must.reservedAt } : {}),
    ...(must.coord !== undefined ? { coord: must.coord } : {}),
  }))
  const { drafts: enforced, missing } = enforceMustStops(drafts, mustDrafts)
  if (missing.length === 0) return enforced
  return restoreMustStops(enforced, missing)
}

// 목록 밖 placeId는 버린다. 이름은 후보 DB 이름 · 바탕 일정 이름 순으로만 정한다.
// AI가 쓴 stop.name은 쓰지 않는다. 둘 다 없으면 그 자리를 버린다 (설계 6.4).
// DB에 없는 자리(null)는 앉는 자리(seated)이고 이름에 숫자·계단 약속이 없을 때만 둔다.
// 붙여넣기 바탕의 null 자리와 이름이 같으면 원래 이름·좌표·seated·visitMin을 옮겨 받는다.
function filterDrafts(
  stops: z.infer<typeof AiStopsSchema>['stops'],
  candidates: PlaceSummary[],
  allowedIds?: Set<string>,
  baseStops?: Stop[],
  // AI가 새로 지은 식사 자리 이름을 버릴지. 건강·식단 이야기("저염 식당")가 가족 화면에 나오지 않게 한다
  rejectName: (name: string) => boolean = () => false,
): DraftStop[] {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate] as const))
  const allowed = allowedIds ?? new Set(candidates.map(candidate => candidate.id))
  // 바탕 일정 placeId → 이름. 같은 곳을 두 번 들르면 처음 이름으로 둔다
  const baseNames = new Map<string, string>()
  for (const base of baseStops ?? []) {
    if (base.placeId !== null && !baseNames.has(base.placeId)) baseNames.set(base.placeId, base.name)
  }
  const remainingBase = [...(baseStops ?? []).filter(stop => stop.placeId === null)]
  const drafts: DraftStop[] = []
  for (const stop of stops) {
    if (stop.placeId !== null) {
      if (!allowed.has(stop.placeId)) continue
      const candidate = byId.get(stop.placeId)
      // 후보 DB 이름이 없으면 바탕 이름, 그래도 없으면 버린다
      const name = candidate?.name ?? baseNames.get(stop.placeId)
      if (name === undefined) continue
      drafts.push({
        placeId: stop.placeId,
        name,
        ...(stop.day !== undefined ? { day: stop.day } : {}),
        ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
        // 머무는 시간은 DB visitMin이 있으면 그것이 우선이다.
        ...(candidate?.visitMin !== undefined
          ? { visitMin: candidate.visitMin }
          : stop.visitMin !== undefined
            ? { visitMin: stop.visitMin }
            : {}),
        ...(stop.seated !== undefined ? { seated: stop.seated } : {}),
        ...(candidate?.coord !== undefined ? { coord: candidate.coord } : {}),
      })
    } else {
      // 바탕 null 자리와 이름이 같으면 원래 값을 옮겨 받는다 (TMAP 좌표 자리가 사라지지 않게).
      const baseIndex = remainingBase.findIndex(base => samePlaceName(base.name, stop.name))
      if (baseIndex >= 0) {
        const [base] = remainingBase.splice(baseIndex, 1)
        if (base === undefined) continue
        drafts.push({
          placeId: null,
          name: base.name,
          ...(stop.day !== undefined ? { day: stop.day } : {}),
          ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
          ...(base.visitMin !== undefined ? { visitMin: base.visitMin } : {}),
          seated: base.seated ?? stop.seated ?? true,
          ...(base.coord !== undefined ? { coord: base.coord } : {}),
        })
        continue
      }
      if (stop.seated !== true) continue
      if (hasNumberOrStairsClaim(stop.name) || rejectName(stop.name)) continue
      drafts.push({
        placeId: null,
        name: stop.name,
        ...(stop.day !== undefined ? { day: stop.day } : {}),
        ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
        ...(stop.visitMin !== undefined ? { visitMin: stop.visitMin } : {}),
        seated: true,
      })
    }
  }
  return drafts
}

// 같은 날 안에서 연달아 같은 placeId는 하나로 줄인다. 떨어져서 두 번은 그대로 둔다.
// 날이 다르면 줄이지 않는다 — 1일차 마지막과 2일차 첫 장소가 같은 곳(예: 숙소)일 수 있다.
function dedupConsecutive(drafts: DraftStop[]): DraftStop[] {
  const out: DraftStop[] = []
  for (const draft of drafts) {
    const prev = out[out.length - 1]
    if (
      prev !== undefined &&
      prev.placeId !== null &&
      draft.placeId !== null &&
      prev.placeId === draft.placeId &&
      (prev.day ?? 1) === (draft.day ?? 1)
    ) {
      continue
    }
    out.push(draft)
  }
  return out
}

export async function handleGenerate(
  request: Request,
  deps: AiDeps,
  opts?: { now?: () => number },
): Promise<Response> {
  return handle(
    async () => {
      const nowFn = opts?.now ?? Date.now
      // 요청마다 50초 예산을 두고 두 번째 시도와 나눠 쓴다 (설계 6.4).
      const deadlineAt = nowFn() + 50000
      const deadlineMs = (): number => Math.max(1, deadlineAt - nowFn())
      const shouldTrySecond = (): boolean => deadlineAt - nowFn() >= 15000
    const input = await readJson(request, GenerateRequestSchema)
    const user = await deps.requireTripMember(request, input.tripId)
    const ctx = await deps.getTripContext(input.tripId)

    // 일정 조건(시간·이동수단·꼭 갈 곳)이 인터뷰에 있으므로 끝내기 전에는 짤 수 없다.
    const state = await deps.interviews.get(input.tripId)
    if (!state || state.cursor.slot !== 'done') {
      throw new HttpError(400, 'invalid_request', '인터뷰를 먼저 마쳐 주세요')
    }
    const filled = state.filled

    if (ctx.travelers.length === 0) {
      throw new HttpError(400, 'invalid_request', '함께 가는 분 정보를 먼저 채워 주세요')
    }

    const profile = groupProfile(ctx.travelers)
    const transport = filled.transport ?? 'car'

    const candidates = await deps.searchCandidates({
      styles: filled.styles,
      ...(filled.budget !== undefined ? { budget: filled.budget } : {}),
      // 장소 사이 이동수단 고르기용이라 대중교통은 버스로 찾는다 (설계 7.3.1).
      transport: transport === 'transit' ? 'bus' : transport,
      avoidStairs: profile.condition.avoidStairs,
      limit: 30,
    })

    // 꼭 갈 곳은 후보에 없으면 목록에 더해 AI가 고를 수 있게 한다.
    // 후보 id를 함께 기억해 나중에 같은 곳인지 가린다.
    const musts: MustNeed[] = []
    // 이미 저장된 인터뷰에 AI가 채운 00:00 예약이 남아 있을 수 있어 여기서도 시간대 밖 예약 시간을 버린다.
    for (const must of mustVisitWithinWindow(filled.mustVisit, filled)) {
      const found = await deps.matchPlaceByName(must.name)
      if (found && !candidates.some(candidate => candidate.id === found.id)) {
        candidates.push(found)
      }
      musts.push({
        placeId: found?.id ?? null,
        name: found?.name ?? must.name,
        ...(must.reservedAt !== undefined ? { reservedAt: must.reservedAt } : {}),
        ...(found?.coord !== undefined ? { coord: found.coord } : {}),
      })
    }

    const isPaste = filled.mode === 'paste'
    let baseStops: Stop[] = []
    let parentId: string | null = null
    let allowedIds: Set<string> | undefined
    if (isPaste) {
      // 붙여넣기 다듬기: 가장 최근 버전을 바탕으로 고친다 (설계 6.4).
      if (ctx.versions.length === 0) {
        throw new HttpError(400, 'invalid_request', '붙여 넣은 일정을 먼저 저장해 주세요')
      }
      const base = ctx.versions.reduce((a, b) => (b.number > a.number ? b : a))
      baseStops = base.stops
      parentId = base.id
      allowedIds = new Set([
        ...candidates.map(candidate => candidate.id),
        ...baseStops.flatMap(stop => (stop.placeId === null ? [] : [stop.placeId])),
      ])
      // 바탕의 꼭 갈 곳·예약은 interview musts와 같은 규칙으로 지킨다.
      for (const stop of baseStops) {
        if (stop.mustVisit || stop.reservedAt !== undefined) {
          if (!musts.some(m => m.placeId === stop.placeId && samePlaceName(m.name, stop.name))) {
            musts.push({
              placeId: stop.placeId,
              name: stop.name,
              ...(stop.reservedAt !== undefined ? { reservedAt: stop.reservedAt } : {}),
              ...(stop.coord !== undefined ? { coord: stop.coord } : {}),
            })
          }
        }
      }
    } else {
      parentId =
        ctx.versions.length === 0
          ? null
          : ctx.versions.reduce((a, b) => (b.number > a.number ? b : a)).id
    }

    // 여러 날: 인터뷰의 시작~끝 날짜로 날 수를 정한다. 붙여넣기 다듬기는 바탕 일정을 고치는 것이라 지금처럼 하루로 둔다.
    const tripDayCount = tripDayList({ date: filled.date ?? null, endDate: filled.endDate ?? null }, []).length
    const dayCount = isPaste ? 1 : Math.min(GENERATE_DAYS_MAX, tripDayCount)
    // 여러 날이면 "하루 여행"이라는 첫 문장을 바꾸고 날 지시를 붙인다
    const systemPrompt =
      dayCount > 1
        ? `${SYSTEM_PROMPT.replace('대전 하루 여행 일정을 짠다.', '대전 여행 일정을 짠다.')} ${multiDayPrompt(dayCount)}`
        : SYSTEM_PROMPT
    const dayWish =
      dayCount > 1
        ? tripDayCount > dayCount
          ? `여행 ${tripDayCount}일 가운데 앞 ${dayCount}일을 날마다 `
          : `${dayCount}일 동안 날마다 `
        : ''

    const timeWish =
      filled.startTime !== undefined && filled.endTime !== undefined
        ? `출발 ${filled.startTime} ~ 귀가 ${filled.endTime} 안에`
        : '하루 안에'
    const mustWish =
      filled.mustVisit.length > 0
        ? `꼭 갈 곳: ${filled.mustVisit.map(must => (must.reservedAt ? `${must.name} (예약 ${must.reservedAt})` : must.name)).join(', ')}`
        : '꼭 갈 곳 없음'

    // 피할 음식(병·약에서 나온 태그만)과 운동 참고 줄. 병·약 이름은 어디에도 가지 않는다 (AGENTS 6장).
    // 비·눈·폭염인 날은 실내 위주로 하라는 날씨 줄도 붙인다 (판정은 바꾸지 않는다). 날짜는 인터뷰가 정한 것을 먼저 본다
    const weatherDates = filled.date
      ? { date: filled.date, endDate: filled.endDate ?? null }
      : { date: ctx.trip.date ?? null, endDate: ctx.trip.endDate ?? null }
    const [avoidTags, weatherLine] = await Promise.all([
      readAvoidFoodTags(deps, input.tripId),
      readWeatherLine(deps, weatherDates, dayCount),
    ])
    const partyBlock = [...partyNoteLines(avoidTags, ctx.travelers), ...(weatherLine ? [weatherLine] : [])]
      .map(line => `${line}\n`)
      .join('')

    // AI가 돌려준 한 줄 메모는 저장된 시도의 것으로 쓴다 — planJudgeSave가 고른 시도의 메타를 읽는다.
    const args: {
      tripId: string
      travelers: Traveler[]
      transport: 'car' | 'transit' | 'taxi'
      attempt: PlanAttempt
      parentId: string | null
      madeByUserId: string
      shouldTrySecond: () => boolean
    } = {
      tripId: input.tripId,
      travelers: ctx.travelers,
      transport,
      attempt: async feedback => {
        const baseBlock = isPaste
          ? `현재 일정:\n${baseStops.map(scheduleLine).join('\n')}\n` +
            `고치고 싶은 곳: ${filled.fixTargets.length > 0 ? filled.fixTargets.join(', ') : '없음'}\n` +
            '고치고 싶은 곳을 반영해 다듬어라. 바탕에 있던 장소는 남겨도 된다.\n'
          : ''
        const userText =
          `후보 장소 목록:\n${candidates.map(candidateLine).join('\n')}\n` +
          baseBlock +
          `${dayWish}${timeWish} 일정을 짜라.\n${mustWish}\n` +
          partyBlock +
          (feedback === null
            ? ''
            : `앞 일정은 이런 이유로 부모님 조건을 넘었다:\n${feedback}\n덜 걷게 다시 골라라.`)
        // attempt 안에서는 AiCallError를 그대로 던진다 — 502 변환은 handle이 한다.
        const parsed: z.infer<typeof AiStopsSchema> = await deps.callJson(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userText },
            ],
            schema: AiStopsSchema,
          },
          { deadlineMs: deadlineMs() },
        )
        // 메모에 숫자·계단 약속이 있으면 버린다 — 숫자는 엔진에서만 나온다 (설계 6.4).
        // 건강 상태를 짐작한 말("당뇨가 있으셔서…")도 버린다 — 프롬프트에 병 이름을 안 넣어도 AI가 짐작해 쓸 수 있다.
        const note =
          parsed.note !== undefined && !hasNumberOrStairsClaim(parsed.note) && !hasDietTalk(parsed.note, avoidTags)
            ? parsed.note
            : undefined
        // AI가 정한 시간이 출발~귀가 밖이면 지운다 (데모 버그 11/2: 성심당 00:00).
        // 붙여넣기 바탕에 사람이 적어 둔 같은 장소·같은 시간은 시간대 밖이어도 남긴다.
        const filtered = dropTimesOutsideWindow(
          filterDrafts(parsed.stops, candidates, allowedIds, isPaste ? baseStops : undefined, name => hasDietTalk(name, avoidTags)),
          filled,
          draft => baseStops.some(base => base.startTime === draft.startTime && samePlaceName(base.name, draft.name)),
        )
        // 고른 장소가 하나도 남지 않으면 AI 실패로 본다 (설계 6.4).
        if (filtered.length === 0) {
          throw new AiCallError('invalid_output', 'AI가 고른 장소가 없어요')
        }
        // 날을 정리한 뒤 꼭 갈 곳을 맞추고, 되돌려 넣은 꼭 갈 곳에도 날을 붙인다(앞 장소의 날).
        // 하루짜리는 모두 1일차가 되어 day 칸이 저장되지 않는다(draftsToStops) — 지금 저장 모양과 같다.
        const drafts = dedupConsecutive(
          arrangeDraftsByDay(applyMustVisit(arrangeDraftsByDay(filtered, dayCount), musts), dayCount),
        )
        if (drafts.length === 0) {
          throw new AiCallError('invalid_output', 'AI가 고른 장소가 없어요')
        }
        return note === undefined ? { drafts } : { drafts, note }
      },
      parentId,
      madeByUserId: user.userId,
      shouldTrySecond,
    }

      const { version, summary } = await planJudgeSave(args, deps)
      return PlanResponseSchema.parse({ version, summary })
    },
    { aiFallback: 'retry_or_pick' },
  )
}
