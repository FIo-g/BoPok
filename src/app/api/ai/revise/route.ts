import { getAiDeps } from '@/lib/ai/dev-deps'
import { handleRevise } from '@/lib/ai/revise'

export const maxDuration = 60

export async function POST(request: Request) {
  return handleRevise(request, getAiDeps())
}
