// 붙여넣은 일정을 장소 이름·시간만 뽑아 Stop[]로 바꾼다 (설계 6.4 A).
// 장소 DB에 없으면 TMAP POI 좌표만 붙여 '정보 없음' 장소로 두고, 걷는 시간은 만들지 않는다.
import 'server-only'
import { z } from 'zod'
import {
  ParseScheduleRequestSchema,
  ParseScheduleResponseSchema,
  TimeSchema,
  type Coord,
  type PlaceSummary,
} from '@/lib/contracts'
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { HttpError, handle, readJson } from './http'
import { initialState } from './interview'
import { draftsToStops, type DraftStop } from './stops'

// AI가 돌려줄 모양. 시간은 문자열로 받고 TimeSchema로 골라낸다 —
// '12시' 같은 값은 그 칸만 버리고 전체 실패로 만들지 않는다.
const ParsedItemsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        startTime: z.string().optional(),
        reservedAt: z.string().optional(),
        mustVisit: z.boolean().optional(),
        seated: z.boolean().optional(),
      }),
    )
    .max(30),
})

const SYSTEM_PROMPT =
  '붙여넣은 여행 일정에서 장소 이름과 시간만 뽑아라. 식사·카페 자리는 seated true. 걷는 시간·거리는 쓰지 마라. ' +
  '예약 시간이 있으면 reservedAt, 이름에 ‘꼭’·‘예약’이 붙은 곳은 mustVisit true로 둬라. ' +
  '반드시 JSON으로만 답하라. 모양: {"items":[{"name":"장소 이름","startTime":"HH:mm","reservedAt":"HH:mm","mustVisit":true,"seated":true}]}'

function cleanTime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const parsed = TimeSchema.safeParse(value.trim())
  return parsed.success ? parsed.data : undefined
}

export async function handleParseSchedule(request: Request, deps: AiDeps): Promise<Response> {
  return handle(async () => {
    const input = await readJson(request, ParseScheduleRequestSchema)
    await deps.requireTripMember(request, input.tripId)

    // AI가 실패해도 원문은 남겨 사용자가 직접 고를 수 있게 한다 (설계 6.4).
    // 인터뷰 상태가 없으면 지금 여행자로 시작 상태를 만들고 원문을 저장한다.
    // 이동수단을 아직 모르면 'car'로 둔다 — 인터뷰 뒤 일정 화면에서 바꿀 수 있음.
    let state = await deps.interviews.get(input.tripId)
    if (!state) {
      const ctx = await deps.getTripContext(input.tripId)
      const fresh = initialState(ctx.trip.startMode, ctx.travelers)
      state = {
        ...fresh,
        filled: { ...fresh.filled, pastedText: input.text },
      }
      await deps.interviews.save(input.tripId, state)
    } else {
      await deps.interviews.save(input.tripId, {
        ...state,
        filled: { ...state.filled, pastedText: input.text },
      })
    }

    let parsed: z.infer<typeof ParsedItemsSchema>
    try {
      parsed = await deps.callJson({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input.text },
        ],
        schema: ParsedItemsSchema,
        temperature: 0,
      })
    } catch (error) {
      if (error instanceof AiCallError) {
        throw new HttpError(502, 'ai_failed', 'AI 요청이 실패했어요', 'pick_places')
      }
      throw error
    }

    // 고른 장소가 하나도 없으면 AI 실패로 본다 (설계 6.4).
    if (parsed.items.length === 0) {
      throw new HttpError(502, 'ai_failed', 'AI 요청이 실패했어요', 'pick_places')
    }

    const places: Record<string, PlaceSummary> = {}
    const drafts: DraftStop[] = []
    const unmatched: string[] = []

    for (const item of parsed.items) {
      let found: PlaceSummary | null = null
      try {
        found = await deps.matchPlaceByName(item.name)
      } catch (error) {
        console.error('[ai]', '장소 조회 실패', error instanceof Error ? error.name : typeof error)
        found = null
      }
      let coord: Coord | undefined
      if (found) {
        places[found.id] = found
      } else {
        try {
          const poi = await deps.searchPoi(item.name)
          // DB에 없는 이름은 좌표가 있어도 unmatched에 남긴다 (정보 없음 장소).
          if (poi) coord = poi.coord
        } catch (error) {
          console.error('[ai]', '장소 조회 실패', error instanceof Error ? error.name : typeof error)
        }
        unmatched.push(item.name)
      }

      drafts.push({
        placeId: found?.id ?? null,
        name: item.name,
        ...(cleanTime(item.startTime) !== undefined ? { startTime: cleanTime(item.startTime) } : {}),
        ...(cleanTime(item.reservedAt) !== undefined ? { reservedAt: cleanTime(item.reservedAt) } : {}),
        ...(item.mustVisit !== undefined ? { mustVisit: item.mustVisit } : {}),
        ...(item.seated !== undefined ? { seated: item.seated } : {}),
        ...(coord !== undefined ? { coord } : {}),
      })
    }

    const transport = state?.filled.transport ?? 'car'
    const stops = draftsToStops(drafts, transport, places)
    return ParseScheduleResponseSchema.parse({ stops, unmatched })
  })
}
