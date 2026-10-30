// 판정 → (조정 필요면) 한 번 다시 → 버전 저장 검사. 가짜 연결 지점만 쓴다.
import { describe, expect, it, vi } from 'vitest'
import {
  JudgeSummarySchema,
  TripVersionSchema,
  type Traveler,
} from '@/lib/contracts'
import { AiCallError } from './client'
import { createDevDeps } from './dev-deps'
import type { AiDeps } from './deps'
import { planJudgeSave, type PlanAttempt } from './plan-and-save'
import type { DraftStop } from './stops'

// 연속 걷기 조건을 크게 두어 한밭수목원에서는 계단 위반만 나오게 한다.
const mom: Traveler = {
  id: 't1',
  label: '엄마',
  isParent: true,
  pace: 'normal',
  mobilityAid: false,
  condition: { continuousMin: 100 },
  filledBySelf: true,
}

const hanbat: DraftStop = { placeId: 'hanbat', name: '한밭수목원' }
const science: DraftStop = { placeId: 'science', name: '국립중앙과학관' }

describe('planJudgeSave', () => {
  it('planJudgeSave: 충족이면 한 번만 부름', async () => {
    const calls: (string | null)[] = []
    const attempt: PlanAttempt = async feedback => {
      calls.push(feedback)
      return [science]
    }

    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      createDevDeps(),
    )

    expect(calls).toEqual([null])
    expect(out.result.verdict).toBe('ok')
    expect(out.version.stops.map(stop => stop.placeId)).toEqual(['science'])
    expect(out.version.madeBy).toBe('ai')
    expect(TripVersionSchema.parse(out.version)).toBeTruthy()
    expect(JudgeSummarySchema.parse(out.summary)).toBeTruthy()
    expect(out.summary).toMatchObject({ verdict: 'ok', reason: out.result.reason })
  })

  it('조정 필요면 위반 숫자를 담아 한 번 더', async () => {
    const calls: (string | null)[] = []
    const attempt: PlanAttempt = async feedback => {
      calls.push(feedback)
      return feedback === null ? [hanbat] : [science]
    }

    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      createDevDeps(),
    )

    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('한밭수목원 안에 계단 구간이 있어요')
    expect(calls[1]).toContain('24')
    expect(out.result.verdict).toBe('ok')
    expect(out.version.stops.map(stop => stop.placeId)).toEqual(['science'])
  })

  it('더 나은 쪽을 저장', async () => {
    const calls: (string | null)[] = []
    const attempt: PlanAttempt = async feedback => {
      calls.push(feedback)
      return feedback === null ? [hanbat] : [hanbat, hanbat]
    }

    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      createDevDeps(),
    )

    expect(calls).toHaveLength(2)
    // 첫 일정(계단 1곳)이 두 번째(계단 2곳)보다 위반이 적다
    expect(out.result.violations).toHaveLength(1)
    expect(out.version.stops).toHaveLength(1)
    expect(out.version.stops[0].key).toBe('s1')
  })

  it('madeByUserId가 createVersion에 들어감', async () => {
    const deps = createDevDeps()
    const seen: string[] = []
    const spied: AiDeps = {
      ...deps,
      createVersion: (async (tripId: string, input: Parameters<AiDeps['createVersion']>[1]) => {
        if (input.madeByUserId) seen.push(input.madeByUserId)
        return deps.createVersion(tripId, input)
      }) as AiDeps['createVersion'],
    }
    const attempt: PlanAttempt = async () => [science]
    await planJudgeSave(
      {
        tripId: 'trip-dev',
        travelers: [mom],
        transport: 'car',
        attempt,
        parentId: null,
        madeByUserId: 'u-mom',
      },
      spied,
    )
    expect(seen).toEqual(['u-mom'])
  })

  it('첫 초안이 비면 AiCallError, 두 번째가 비면 첫 결과 저장', async () => {
    const emptyFirst: PlanAttempt = async () => []
    await expect(
      planJudgeSave(
        { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt: emptyFirst, parentId: null },
        createDevDeps(),
      ),
    ).rejects.toMatchObject({ name: 'AiCallError' })

    const secondEmpty: PlanAttempt = async feedback => (feedback === null ? [hanbat] : [])
    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt: secondEmpty, parentId: null },
      createDevDeps(),
    )
    expect(out.version.stops.map(stop => stop.placeId)).toEqual(['hanbat'])
  })

  it('두 번째 AI 실패면 첫 결과 저장', async () => {
    const attempt: PlanAttempt = async feedback => {
      if (feedback === null) return [hanbat]
      throw new AiCallError('provider_failed', '공급자 호출 실패')
    }
    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      createDevDeps(),
    )
    expect(out.version.stops.map(stop => stop.placeId)).toEqual(['hanbat'])
    expect(out.result.verdict).toBe('adjust')
  })

  it('verdict 순위로 고르기', async () => {
    // 첫 adjust(계단) → 두 번째 info(정보 부족, 위반 0)를 고른다
    const attempt: PlanAttempt = async feedback =>
      feedback === null
        ? [hanbat]
        : [{ placeId: null, name: '점심', seated: true, coord: [127.383, 36.35] }]
    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      createDevDeps(),
    )
    expect(out.result.verdict).toBe('info')
  })

  it('getLegs가 던지면 info로 저장', async () => {
    const deps = createDevDeps()
    const failing: AiDeps = {
      ...deps,
      getLegs: (async () => {
        throw new Error('TMAP 실패')
      }) as AiDeps['getLegs'],
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 가까이 붙여 걷기 경로를 만들면 조회 실패가 missingLegs가 된다
      const attempt: PlanAttempt = async () => [
        { placeId: 'science', name: '국립중앙과학관' },
        { placeId: null, name: '점심', seated: true, coord: [127.2547, 36.3927] },
      ]
      const out = await planJudgeSave(
        { tripId: 'trip-dev', travelers: [mom], transport: 'transit', attempt, parentId: null },
        failing,
      )
      expect(out.result.verdict).toBe('info')
      expect(errorSpy).toHaveBeenCalledWith('[ai]', '장소·경로 조회 실패', expect.anything())
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('다시 묻는 feedback에 앞 일정 이름·id가 들어감', async () => {
    const calls: (string | null)[] = []
    const attempt: PlanAttempt = async feedback => {
      calls.push(feedback)
      return feedback === null ? [hanbat] : [science]
    }
    await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      createDevDeps(),
    )
    expect(calls[1]).toContain('앞 일정:')
    expect(calls[1]).toContain('한밭수목원(id: hanbat)')
  })

  it('선택된 시도의 note·appliedOpinionIds를 저장 (중복 제거)', async () => {
    const deps = createDevDeps()
    const seen: { note?: string | null; appliedOpinionIds?: string[] }[] = []
    const spied: AiDeps = {
      ...deps,
      createVersion: (async (tripId: string, input: Parameters<AiDeps['createVersion']>[1]) => {
        seen.push({ note: input.note, appliedOpinionIds: input.appliedOpinionIds })
        return deps.createVersion(tripId, input)
      }) as AiDeps['createVersion'],
    }
    const attempt: PlanAttempt = async () => ({
      drafts: [science],
      note: '첫',
      appliedOpinionIds: ['o1', 'o1'],
    })
    const out = await planJudgeSave(
      { tripId: 'trip-dev', travelers: [mom], transport: 'car', attempt, parentId: null },
      spied,
    )
    expect(out.result.verdict).toBe('ok')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.note).toBe('첫')
    expect(seen[0]?.appliedOpinionIds).toEqual(['o1'])
  })

  it('시도가 메타를 주지 않으면 인자 note·appliedOpinionIds를 기본값으로', async () => {
    const deps = createDevDeps()
    const seen: { note?: string | null; appliedOpinionIds?: string[] }[] = []
    const spied: AiDeps = {
      ...deps,
      createVersion: (async (tripId: string, input: Parameters<AiDeps['createVersion']>[1]) => {
        seen.push({ note: input.note, appliedOpinionIds: input.appliedOpinionIds })
        return deps.createVersion(tripId, input)
      }) as AiDeps['createVersion'],
    }
    const attempt: PlanAttempt = async () => [science]
    await planJudgeSave(
      {
        tripId: 'trip-dev',
        travelers: [mom],
        transport: 'car',
        attempt,
        parentId: null,
        note: '기본 메모',
        appliedOpinionIds: ['o9'],
      },
      spied,
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]?.note).toBe('기본 메모')
    expect(seen[0]?.appliedOpinionIds).toEqual(['o9'])
  })
})
