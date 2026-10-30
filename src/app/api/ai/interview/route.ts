import { getAiDeps } from '@/lib/ai/dev-deps'
import { handleInterview } from '@/lib/ai/interview'

export async function POST(request: Request) {
  return handleInterview(request, getAiDeps())
}
