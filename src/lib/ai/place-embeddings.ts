import 'server-only'
import { z } from 'zod'

// 신규 연동은 2026-12 사용 종료 예정인 Embedding 1 별칭 대신 Embedding 2를 쓴다.
export const PLACE_EMBEDDING_DIMENSIONS = 1024
export const PLACE_PASSAGE_MODEL = 'solar-embedding-2-passage'
export const PLACE_QUERY_MODEL = 'solar-embedding-2-query'
export const PlaceEmbeddingSchema = z.array(z.number().finite()).length(PLACE_EMBEDDING_DIMENSIONS)
  .refine(vector => vector.some(value => value !== 0), '영벡터는 검색에 쓸 수 없습니다.')

export async function embedPlaceTexts(texts: string[], role: 'query' | 'passage', options: {
  apiKey?: string; fetchFn?: typeof fetch
} = {}): Promise<number[][]> {
  const inputs = z.array(z.string().trim().min(1).max(6000)).min(1).max(16).parse(texts)
  const key = (options.apiKey ?? process.env.UPSTAGE_API_KEY)?.trim()
  if (!key) throw new Error('UPSTAGE_API_KEY가 없어 장소 임베딩을 만들 수 없습니다.')
  const model = role === 'query' ? PLACE_QUERY_MODEL : PLACE_PASSAGE_MODEL
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await (options.fetchFn ?? fetch)('https://api.upstage.ai/v1/embeddings', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: inputs }),
      })
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue
        throw new Error('장소 임베딩 요청이 거절되었습니다.')
      }
      const parsed = z.object({ model: z.literal(model), data: z.array(z.object({
        index: z.number().int().min(0), embedding: PlaceEmbeddingSchema,
      })).length(inputs.length) }).safeParse(await response.json())
      if (!parsed.success) throw new Error('장소 임베딩 응답을 확인하지 못했습니다.')
      const sorted = parsed.data.data.sort((a, b) => a.index - b.index)
      if (sorted.some((item, index) => item.index !== index)) throw new Error('장소 임베딩의 순서가 올바르지 않습니다.')
      return sorted.map(item => item.embedding)
    } catch {
      if (attempt === 1) throw new Error('장소 임베딩을 만들지 못했습니다. 키·사용 한도·응답 형식을 확인해 주세요.')
    }
  }
  throw new Error('장소 임베딩을 만들지 못했습니다.')
}
