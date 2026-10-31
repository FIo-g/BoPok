import 'server-only'
import { ApiErrorSchema, type ApiErrorCode } from '@/lib/contracts'

export function placeError(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json(ApiErrorSchema.parse({ error: { code, message } }), {
    status, headers: { 'Cache-Control': 'no-store' },
  })
}

export function placeResponse(value: unknown): Response {
  return Response.json(value, { headers: { 'Cache-Control': 'no-store' } })
}

export async function readPlaceJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('요청 본문이 없습니다.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16384) {
        await reader.cancel()
        throw new Error('요청 본문이 너무 큽니다.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}
