import { describe, expect, it, vi } from 'vitest'
import { embedPlaceTexts, PLACE_EMBEDDING_DIMENSIONS, PLACE_PASSAGE_MODEL, PLACE_QUERY_MODEL } from './place-embeddings'

const vector = () => Array.from({ length: PLACE_EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0)
describe('Upstage 장소 임베딩', () => {
  it('문서는 passage, 검색은 query 모델을 쓰고 응답 순서를 맞춘다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ model: PLACE_PASSAGE_MODEL, data: [
        { index: 1, embedding: vector() }, { index: 0, embedding: vector() },
      ] }))
      .mockResolvedValueOnce(Response.json({ model: PLACE_QUERY_MODEL, data: [{ index: 0, embedding: vector() }] }))
    expect(await embedPlaceTexts(['문서1', '문서2'], 'passage', { apiKey: 'test-only', fetchFn })).toHaveLength(2)
    await embedPlaceTexts(['검색'], 'query', { apiKey: 'test-only', fetchFn })
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).model).toBe(PLACE_PASSAGE_MODEL)
    expect(JSON.parse(String(fetchFn.mock.calls[1][1]?.body)).model).toBe(PLACE_QUERY_MODEL)
  })

  it.each([
    [{ index: 0, embedding: [1, 0] }],
    [{ index: 0, embedding: Array(1024).fill(0) }],
    [{ index: 1, embedding: vector() }],
  ])('차원·영벡터·인덱스가 잘못되면 검색어는 한 번만 부르고 실패한다', async data => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ model: PLACE_QUERY_MODEL, data }))
    await expect(embedPlaceTexts(['검색'], 'query', { apiKey: 'test-secret', fetchFn })).rejects.not.toThrow('test-secret')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('문서(passage)는 5xx에 한 번 재시도한 뒤 성공한다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('server error', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ model: PLACE_PASSAGE_MODEL, data: [{ index: 0, embedding: vector() }] }))
    expect(await embedPlaceTexts(['문서'], 'passage', { apiKey: 'test-only', fetchFn })).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('키가 없으면 외부 호출을 하지 않는다', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    await expect(embedPlaceTexts(['검색'], 'query', { apiKey: '', fetchFn })).rejects.toThrow('UPSTAGE_API_KEY')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
