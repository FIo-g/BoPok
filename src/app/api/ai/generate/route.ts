import { getAiDeps } from '@/lib/ai/dev-deps'
import { handleGenerate } from '@/lib/ai/generate'

export const maxDuration = 60

export async function POST(request: Request) {
  return handleGenerate(request, getAiDeps())
}
