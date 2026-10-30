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
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { HttpError, handle, readJson } from './http'
import { planJudgeSave, type PlanAttempt } from './plan-and-save'
import { enforceMustStops, restoreMustStops, samePlaceName, type DraftStop } from './stops'
import { hasNumberOrStairsClaim, sanitizePromptText } from './text-guard'

// AI가 돌려줄 모양. 걷는 시간·거리·계단 칸은 두지 않는다 (엔진이 계산한다).
const AiStopsSchema = z.object({
  stops: z.array(
    z.object({
      placeId: z.string().nullable(),
      name: z.string().trim().min(1).max(100),
      startTime: TimeSchema.optional(),
      visitMin: nonNegative.optional(),
      seated: z.boolean().optional(),
    }),
  ),
  note: z.string().max(500).optional(),
})

const SYSTEM_PROMPT =
  '대전 하루 여행 일정을 짠다. 이 목록의 id로만 골라라. 식사 자리는 placeId null + 이름으로 넣는다. ' +
  '출발·귀가 시간 안에 3~5곳을 고른다. 꼭 갈 곳은 반드시 넣고 예약 시간 그대로 둔다. ' +
  '걷는 시간·거리·계단 수는 쓰지 마라. ' +
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
          ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
          ...(base.visitMin !== undefined ? { visitMin: base.visitMin } : {}),
          seated: base.seated ?? stop.seated ?? true,
          ...(base.coord !== undefined ? { coord: base.coord } : {}),
        })
        continue
      }
      if (stop.seated !== true) continue
      if (hasNumberOrStairsClaim(stop.name)) continue
      drafts.push({
        placeId: null,
        name: stop.name,
        ...(stop.startTime !== undefined ? { startTime: stop.startTime } : {}),
        ...(stop.visitMin !== undefined ? { visitMin: stop.visitMin } : {}),
        seated: true,
      })
    }
  }
  return drafts
}

// 연달아 같은 placeId는 하나로 줄인다. 떨어져서 두 번은 그대로 둔다.
function dedupConsecutive(drafts: DraftStop[]): DraftStop[] {
  const out: DraftStop[] = []
  for (const draft of drafts) {
    const prev = out[out.length - 1]
    if (
      prev !== undefined &&
      prev.placeId !== null &&
      draft.placeId !== null &&
      prev.placeId === draft.placeId
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
    for (const must of filled.mustVisit) {
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

    const timeWish =
      filled.startTime !== undefined && filled.endTime !== undefined
        ? `출발 ${filled.startTime} ~ 귀가 ${filled.endTime} 안에`
        : '하루 안에'
    const mustWish =
      filled.mustVisit.length > 0
        ? `꼭 갈 곳: ${filled.mustVisit.map(must => (must.reservedAt ? `${must.name} (예약 ${must.reservedAt})` : must.name)).join(', ')}`
        : '꼭 갈 곳 없음'

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
          `${timeWish} 일정을 짜라.\n${mustWish}\n` +
          (feedback === null
            ? ''
            : `앞 일정은 이런 이유로 부모님 조건을 넘었다:\n${feedback}\n덜 걷게 다시 골라라.`)
        // attempt 안에서는 AiCallError를 그대로 던진다 — 502 변환은 handle이 한다.
        const parsed: z.infer<typeof AiStopsSchema> = await deps.callJson(
          {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userText },
            ],
            schema: AiStopsSchema,
          },
          { deadlineMs: deadlineMs() },
        )
        // 메모에 숫자·계단 약속이 있으면 버린다 — 숫자는 엔진에서만 나온다 (설계 6.4).
        const note =
          parsed.note !== undefined && !hasNumberOrStairsClaim(parsed.note) ? parsed.note : undefined
        const filtered = filterDrafts(parsed.stops, candidates, allowedIds, isPaste ? baseStops : undefined)
        // 고른 장소가 하나도 남지 않으면 AI 실패로 본다 (설계 6.4).
        if (filtered.length === 0) {
          throw new AiCallError('invalid_output', 'AI가 고른 장소가 없어요')
        }
        const drafts = dedupConsecutive(applyMustVisit(filtered, musts))
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
