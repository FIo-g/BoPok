import { getAiDeps } from '@/lib/ai/dev-deps'
import { handleExplain } from '@/lib/ai/explain'

export async function POST(request: Request) {
  return handleExplain(request, getAiDeps())
}
