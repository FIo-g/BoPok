// handle·errorResponse가 에러를 계약 모양({ error: { code, message } })으로 바꾸는지 확인한다.
// 1단계 PR 리뷰에서 김태형이 "JSON 변환 테스트는 2단계에서" 남긴 부분. DB가 필요 없어서 따로 둔다.
import { describe, expect, it, vi } from 'vitest'
import { ApiErrorSchema } from '@/lib/contracts'
import { HttpError, errorResponse, handle, readJson } from './http'

describe('handle', () => {
  it('성공하면 돌려준 값을 JSON으로 내보낸다', async () => {
    const response = await handle(async () => ({ hello: '안녕' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toEqual({ hello: '안녕' })
  })

  it('HttpError는 그 상태 코드와 계약 모양으로 나간다', async () => {
    const response = await handle(async () => {
      throw new HttpError(403, 'forbidden', '이 그룹의 구성원이 아니에요')
    })
    expect(response.status).toBe(403)
    const body = await response.json()
    // 계약 스키마로 검사한다 — 모양이 어긋나면 여기서 걸린다
    expect(ApiErrorSchema.parse(body)).toEqual({
      error: { code: 'forbidden', message: '이 그룹의 구성원이 아니에요' },
    })
  })

  it('그 외 오류는 500 internal_error이고, 내부 메시지를 응답에 담지 않는다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secret = 'DB 연결 문자열 같은 내부 사정'

    const response = await handle(async () => {
      throw new Error(secret)
    })

    expect(response.status).toBe(500)
    const body = ApiErrorSchema.parse(await response.json())
    expect(body.error.code).toBe('internal_error')
    expect(JSON.stringify(body)).not.toContain(secret)
    // 대신 서버 로그에는 남는다 (고칠 때 필요하므로)
    expect(logged).toHaveBeenCalled()
    expect(logged.mock.calls[0].join(' ')).toContain(secret)
    logged.mockRestore()
  })
})

describe('errorResponse', () => {
  it('상태 코드별로 계약 모양을 지킨다', async () => {
    const cases = [
      { error: new HttpError(401, 'unauthorized', '로그인이 필요해요'), status: 401, code: 'unauthorized' },
      { error: new HttpError(400, 'invalid_request', '요청 내용이 형식에 맞지 않아요'), status: 400, code: 'invalid_request' },
      { error: new HttpError(404, 'not_found', '그룹을 찾을 수 없어요'), status: 404, code: 'not_found' },
      { error: new HttpError(410, 'expired', '초대 링크가 만료됐어요'), status: 410, code: 'expired' },
    ] as const

    for (const one of cases) {
      const response = errorResponse(one.error)
      expect(response.status).toBe(one.status)
      const body = ApiErrorSchema.parse(await response.json())
      expect(body.error.code).toBe(one.code)
      expect(body.error.message.length).toBeGreaterThan(0)
    }
  })
})

describe('readJson', () => {
  const schema = ApiErrorSchema.shape.error.pick({ message: true })

  const post = (body?: string) =>
    new Request('http://localhost:3000/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

  it('스키마에 맞으면 검사된 값을 돌려준다', async () => {
    await expect(readJson(post(JSON.stringify({ message: '안녕' })), schema)).resolves.toEqual({ message: '안녕' })
  })

  it('모양이 틀리면 400이고, 어떤 칸이 틀렸는지 응답에 담지 않는다', async () => {
    const error = await readJson(post(JSON.stringify({ message: 123 })), schema).catch(caught => caught)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(400)
    expect((error as HttpError).code).toBe('invalid_request')
    expect((error as HttpError).message).not.toContain('message')
  })

  it('몸체가 없으면 400 — allowEmpty를 주면 빈 객체로 본다', async () => {
    const strict = await readJson(post(), schema).catch(caught => caught)
    expect((strict as HttpError).status).toBe(400)

    const anything = ApiErrorSchema.shape.error.partial().pick({ message: true })
    await expect(readJson(post(), anything, { allowEmpty: true })).resolves.toEqual({})
  })
})
