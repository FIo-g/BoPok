// 바뀐 점 한 줄 (설계 6.1·6.4). AI는 고정 문장과 엔진 비교 줄의 숫자만 써서 한 문장으로 다듬는다.
// 입력에 없던 숫자나 60자를 넘기면 고정 문장을 그대로 돌려준다. AI 실패도 고정 문장이라 502가 아니다.
import 'server-only'
import { z } from 'zod'
import {
  ExplainRequestSchema,
  ExplainResponseSchema,
  type JudgeResult,
  type QuickFixChange,
} from '@/lib/contracts'
import { diffSummary, fixedChangeSentence, formatDiffItem } from '@/lib/engine'
import { AiCallError } from './client'
import type { AiDeps } from './deps'
import { HttpError, handle, readJson } from './http'
import { hasKoreanNumberClaim, hasStairsClaim, normalizeAiText, numberPhrases } from './text-guard'

// AI가 돌려줄 모양. 걷는 시간 계산 칸은 두지 않는다 (숫자는 엔진 결과에만 있다).
const AiTextSchema = z.object({ text: z.string() })

const SYSTEM_PROMPT =
  '부모님 입장에서 달라지는 점을 한 문장(60자 이내)으로. 아래 숫자만 쓰고 새 숫자를 만들지 마라. ' +
  "계단이 없다는 말은 쓰지 마라. 시간은 '약 N~M분' 구절을 그대로 쓰라."

export function numbersIn(text: string): string[] {
  return text.match(/\d+/g) ?? []
}

export async function explainChange(
  prev: JudgeResult,
  next: JudgeResult,
  changes: QuickFixChange[] | undefined,
  deps: Pick<AiDeps, 'callJson'>,
  opts?: { deadlineMs?: number },
): Promise<{ text: string; source: 'ai' | 'fixed' }> {
  const diff = diffSummary(prev, next)
  const fixed =
    changes && changes.length > 0
      ? fixedChangeSentence(changes)
      : diff.map(formatDiffItem).join(', ') || '바뀐 점 없음'
  // 바뀐 것이 없으면 AI를 부르지 않는다.
  if (diff.length === 0 && (changes === undefined || changes.length === 0)) {
    return { text: fixed, source: 'fixed' }
  }
  const lines = diff.map(formatDiffItem)
  const inputs = [fixed, ...lines].join('\n')
  // 입력 문장들의 숫자 구절 집합 — AI 구절은 통째로 여기 있어야 한다 (부분 문자열 비교 금지).
  const inputSet = new Set(numberPhrases(inputs))

  let aiText: string
  try {
    const parsed = await deps.callJson(
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [`바뀐 점: ${fixed}`, ...lines.map(line => `- ${line}`)].join('\n') },
        ],
        schema: AiTextSchema,
      },
      { deadlineMs: opts?.deadlineMs ?? 15000 },
    )
    aiText = parsed.text.trim()
  } catch (error) {
    // AI 실패는 고정 문장으로 돌린다 (설계 6.1·노션 4-3)
    if (error instanceof AiCallError) return { text: fixed, source: 'fixed' }
    throw error
  }
  if (aiText.length === 0) return { text: fixed, source: 'fixed' }
  // 글자 수로 센다 — 이모지 등 surrogate pair를 1자로 본다.
  if (Array.from(aiText).length > 60) return { text: fixed, source: 'fixed' }
  // 한글 수사·계단 표현이 있으면 고정 문장으로 돌린다 — 숫자 자체는 구절 비교로 허용한다.
  if (hasKoreanNumberClaim(aiText)) return { text: fixed, source: 'fixed' }
  if (hasStairsClaim(aiText)) return { text: fixed, source: 'fixed' }
  const phrases = numberPhrases(aiText)
  // 숫자 구절은 입력 문장들에 통째로 있는 것만 쓸 수 있다 — 범위를 한 점으로 줄여도 안 된다.
  if (!phrases.every(phrase => inputSet.has(phrase))) return { text: fixed, source: 'fixed' }
  // AI 문장에 숫자가 하나도 없고 입력에도 숫자가 없으면 그대로 둔다.
  // 빈 문장은 위에서 걸렀고, 숫자 없는 AI 문장은 입력 구절 비교를 통과한다.
  void normalizeAiText
  return { text: aiText, source: 'ai' }
}

export async function handleExplain(
  request: Request,
  deps: AiDeps,
  opts?: { now?: () => number },
): Promise<Response> {
  return handle(async () => {
    const nowFn = opts?.now ?? Date.now
    const deadlineAt = nowFn() + 15000
    const input = await readJson(request, ExplainRequestSchema)
    // changes 배열 크기 상한 — 스키마(계약)는 그대로 두고 여기서 막는다.
    if (input.changes !== undefined && input.changes.length > 50) {
      throw new HttpError(400, 'invalid_request', '변경 목록이 너무 많아요')
    }
    await deps.requireTripMember(request, input.tripId)
    const { text, source } = await explainChange(input.prev, input.next, input.changes, deps, {
      deadlineMs: Math.max(1, deadlineAt - nowFn()),
    })
    return ExplainResponseSchema.parse({ text, source })
  })
}
