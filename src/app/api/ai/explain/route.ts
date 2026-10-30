import { getAiDeps } from '@/lib/ai/dev-deps'
import { handleExplain } from '@/lib/ai/explain'

export const maxDuration = 30

export async function POST(request: Request) {
  return handleExplain(request, getAiDeps())
}
