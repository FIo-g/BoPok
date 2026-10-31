import { getAiDeps } from '@/lib/ai/real-deps'
import { handleInterview } from '@/lib/ai/interview'

export const maxDuration = 30

export async function POST(request: Request) {
  return handleInterview(request, getAiDeps())
}
