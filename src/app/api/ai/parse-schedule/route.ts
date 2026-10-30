import { getAiDeps } from '@/lib/ai/dev-deps'
import { handleParseSchedule } from '@/lib/ai/parse-schedule'

export const maxDuration = 60

export async function POST(request: Request) {
  return handleParseSchedule(request, getAiDeps())
}
