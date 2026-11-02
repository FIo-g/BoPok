import { describe, expect, it } from 'vitest'
import { AcceptInviteRequestSchema } from '@/lib/contracts'
import { RELATION_OPTIONS, relationToSend } from './invite-relation'

describe('초대 참가 때 보낼 관계', () => {
  it('고르지 않았거나 빈칸이면 보내지 않는다 (관계 없이 참가)', () => {
    expect(relationToSend(null)).toBeUndefined()
    expect(relationToSend(undefined)).toBeUndefined()
    expect(relationToSend('')).toBeUndefined()
    expect(relationToSend('   ')).toBeUndefined()
  })

  it('앞뒤 공백을 지우고 20자까지만 보낸다', () => {
    expect(relationToSend('  며느리 ')).toBe('며느리')
    expect(relationToSend('가'.repeat(25))).toBe('가'.repeat(20))
  })

  it('칩 값과 다듬은 값은 모두 서버 스키마를 통과한다', () => {
    for (const option of RELATION_OPTIONS) {
      expect(AcceptInviteRequestSchema.safeParse({ relation: relationToSend(option) }).success).toBe(true)
    }
    expect(AcceptInviteRequestSchema.safeParse({ relation: relationToSend(` ${'가'.repeat(30)} `) }).success).toBe(true)
  })
})
