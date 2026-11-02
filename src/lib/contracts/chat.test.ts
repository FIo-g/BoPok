import { describe, expect, it } from 'vitest'
import {
  CHAT_TEXT_MAX,
  ChatListQuerySchema,
  ChatMessageSchema,
  ChatPostRequestSchema,
  ReviseRequestSchema,
} from './index'

describe('그룹 채팅', () => {
  it('글자 수 한도는 500', () => {
    expect(CHAT_TEXT_MAX).toBe(500)
  })

  it('공백뿐인 글은 거부', () => {
    expect(ChatPostRequestSchema.safeParse({ text: '' }).success).toBe(false)
    expect(ChatPostRequestSchema.safeParse({ text: '   \n ' }).success).toBe(false)
  })

  it('500자까지 통과, 501자는 거부', () => {
    expect(ChatPostRequestSchema.safeParse({ text: 'a'.repeat(500) }).success).toBe(true)
    expect(ChatPostRequestSchema.safeParse({ text: 'a'.repeat(501) }).success).toBe(false)
  })

  it('앞뒤 공백은 잘린다 (공백을 뺀 길이로 한도를 잰다)', () => {
    expect(ChatPostRequestSchema.parse({ text: '  좋아요  ' }).text).toBe('좋아요')
    expect(ChatPostRequestSchema.safeParse({ text: ` ${'a'.repeat(500)} ` }).success).toBe(true)
  })

  it('저장된 글 한 건', () => {
    const message = {
      id: 'c1',
      tripId: 'trip1',
      userId: 'u-son',
      userName: '아들',
      text: '둘째 날은 좀 쉬어가요',
      createdAt: '2026-11-02T09:00:00.000Z',
    }
    expect(ChatMessageSchema.safeParse(message).success).toBe(true)
    expect(ChatMessageSchema.safeParse({ ...message, text: '' }).success).toBe(false)
    expect(ChatMessageSchema.safeParse({ ...message, text: 'a'.repeat(501) }).success).toBe(false)
  })

  it('목록 조회는 after를 안 줘도 된다', () => {
    expect(ChatListQuerySchema.parse({})).toEqual({})
    expect(ChatListQuerySchema.parse({ after: '2026-11-02T09:00:00.000Z' })).toEqual({
      after: '2026-11-02T09:00:00.000Z',
    })
  })
})

describe('다시 짜기 요청에 채팅 넘기기', () => {
  it('기존 { tripId, versionId }만 있는 요청이 그대로 통과한다', () => {
    const body = { tripId: 'trip1', versionId: 'v1' }
    expect(ReviseRequestSchema.parse(body)).toEqual(body)
  })

  it('includeChat: true도 통과한다', () => {
    expect(ReviseRequestSchema.parse({ tripId: 'trip1', versionId: 'v1', includeChat: true }).includeChat).toBe(true)
  })

  it('includeChat이 불리언이 아니면 거부한다', () => {
    expect(ReviseRequestSchema.safeParse({ tripId: 'trip1', versionId: 'v1', includeChat: 'yes' }).success).toBe(false)
  })
})
