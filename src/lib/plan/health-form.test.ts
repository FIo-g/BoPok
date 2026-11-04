import { describe, expect, it } from 'vitest'
import { HealthConditionSchema, MedicationClassSchema, TravelerHealthInputSchema, type TravelerHealth } from '@/lib/contracts'
import {
  canSubmitHealth,
  healthEditMode,
  healthFormInput,
  initialHealthForm,
  removeHealthFromList,
  toggleIn,
  upsertHealthList,
  type HealthFormState,
} from './health-form'

const health = (travelerId: string, extra: Partial<TravelerHealth> = {}): TravelerHealth => ({
  tripId: 'trip-1',
  travelerId,
  conditions: ['diabetes'],
  medicationClasses: [],
  visibility: 'group',
  consentAt: '2026-11-02T01:00:00.000Z',
  enteredByUserId: 'u-son',
  ...extra,
})

const form = (extra: Partial<HealthFormState> = {}): HealthFormState => ({
  conditions: [],
  medicationClasses: [],
  visibility: 'self',
  consent: false,
  ...extra,
})

describe('initialHealthForm', () => {
  it('저장된 것이 없으면 비어 있고, 보이는 범위는 본인만, 동의는 안 한 상태', () => {
    expect(initialHealthForm(undefined)).toEqual({ conditions: [], medicationClasses: [], visibility: 'self', consent: false })
  })

  it('저장된 것이 있으면 그 값에서 시작하되 동의는 다시 받는다', () => {
    const existing = health('mom', { conditions: ['diabetes', 'gout'], medicationClasses: ['warfarin'], visibility: 'group' })
    expect(initialHealthForm(existing)).toEqual({ conditions: ['diabetes', 'gout'], medicationClasses: ['warfarin'], visibility: 'group', consent: false })
  })

  it('저장된 기록의 배열을 그대로 물고 있지 않는다 (폼을 고쳐도 목록이 바뀌지 않게)', () => {
    const existing = health('mom', { conditions: ['diabetes'] })
    const started = initialHealthForm(existing)
    started.conditions.push('gout')
    expect(existing.conditions).toEqual(['diabetes'])
  })
})

describe('toggleIn', () => {
  const order = HealthConditionSchema.options

  it('없으면 넣고 있으면 뺀다', () => {
    expect(toggleIn([], 'gout', order)).toEqual(['gout'])
    expect(toggleIn(['gout'], 'gout', order)).toEqual([])
  })

  it('고른 순서와 상관없이 스키마 options 순서로 돌려준다 (같은 고르기 → 같은 값)', () => {
    const a = toggleIn(toggleIn(toggleIn([], 'gout', order), 'diabetes', order), 'heart_disease', order)
    const b = toggleIn(toggleIn(toggleIn([], 'heart_disease', order), 'gout', order), 'diabetes', order)
    expect(a).toEqual(['diabetes', 'gout', 'heart_disease'])
    expect(b).toEqual(a)
  })

  it('약 종류도 같은 규칙이다', () => {
    const meds = MedicationClassSchema.options
    expect(toggleIn(['calcium_channel_blocker'], 'warfarin', meds)).toEqual(['warfarin', 'calcium_channel_blocker'])
  })

  it('받은 목록을 바꾸지 않는다', () => {
    const list: typeof order[number][] = ['gout']
    toggleIn(list, 'diabetes', order)
    expect(list).toEqual(['gout'])
  })
})

describe('healthFormInput', () => {
  it('동의하지 않았으면 null (저장 요청을 만들지 않는다)', () => {
    expect(healthFormInput(form({ conditions: ['diabetes'] }))).toBeNull()
  })

  it('동의했으면 consent: true 가 붙은 요청 본문이고 서버 스키마를 통과한다', () => {
    const input = healthFormInput(form({ conditions: ['diabetes'], medicationClasses: ['warfarin'], visibility: 'group', consent: true }))
    expect(input).toEqual({ conditions: ['diabetes'], medicationClasses: ['warfarin'], visibility: 'group', consent: true })
    expect(TravelerHealthInputSchema.safeParse(input).success).toBe(true)
  })

  it('고른 것이 없어도 동의했으면 저장할 수 있다 (해당하는 것이 없을 수 있다)', () => {
    expect(healthFormInput(form({ consent: true }))).toEqual({ conditions: [], medicationClasses: [], visibility: 'self', consent: true })
  })
})

describe('canSubmitHealth', () => {
  it('동의 체크가 없으면 못 누른다', () => {
    expect(canSubmitHealth(form({ consent: false }), false)).toBe(false)
  })

  it('동의했고 저장 중이 아니면 누를 수 있다', () => {
    expect(canSubmitHealth(form({ consent: true }), false)).toBe(true)
  })

  it('저장 중에는 못 누른다', () => {
    expect(canSubmitHealth(form({ consent: true }), true)).toBe(false)
  })
})

describe('건강 목록 갱신', () => {
  const list = [health('mom'), health('dad', { conditions: ['gout'] })]

  it('upsert: 같은 여행자는 제자리에서 바꾼다', () => {
    const saved = health('mom', { conditions: ['hypertension'] })
    const next = upsertHealthList(list, saved)
    expect(next).toEqual([saved, list[1]])
  })

  it('upsert: 없던 여행자는 뒤에 더한다', () => {
    const saved = health('me')
    expect(upsertHealthList(list, saved)).toEqual([...list, saved])
  })

  it('upsert·remove 모두 받은 목록을 바꾸지 않는다', () => {
    upsertHealthList(list, health('me'))
    removeHealthFromList(list, 'mom')
    expect(list.map(h => h.travelerId)).toEqual(['mom', 'dad'])
  })

  it('remove: 그 여행자만 뺀다', () => {
    expect(removeHealthFromList(list, 'mom').map(h => h.travelerId)).toEqual(['dad'])
  })

  it('remove: 없는 여행자는 그대로', () => {
    expect(removeHealthFromList(list, 'nobody')).toEqual(list)
  })
})

describe('healthEditMode (서버가 저장해 둔 여행자 기준)', () => {
  it('서버에 저장되지 않은 새 여행자는 먼저 저장해야 한다', () => {
    expect(healthEditMode({ existing: undefined, savedTraveler: undefined, viewerUserId: 'u-me' })).toBe('unsaved')
  })

  it('내 계정과 연결된 여행자는 내가 고친다', () => {
    expect(healthEditMode({ existing: undefined, savedTraveler: { userId: 'u-me' }, viewerUserId: 'u-me' })).toBe('edit')
    expect(healthEditMode({ existing: health('me', { enteredByUserId: 'u-son' }), savedTraveler: { userId: 'u-me' }, viewerUserId: 'u-me' })).toBe('edit')
  })

  it('남의 계정과 연결된 여행자는 읽기만 (이 분이 직접 입력해요)', () => {
    expect(healthEditMode({ existing: undefined, savedTraveler: { userId: 'u-mom' }, viewerUserId: 'u-son' })).toBe('readonly_linked')
    // 처음 입력한 사람이어도 계정이 연결된 뒤에는 본인만 고친다
    expect(healthEditMode({ existing: health('mom', { enteredByUserId: 'u-son' }), savedTraveler: { userId: 'u-mom' }, viewerUserId: 'u-son' })).toBe('readonly_linked')
  })

  it('계정 없는 여행자는 기록이 없으면 그룹 누구나 처음 입력할 수 있다', () => {
    expect(healthEditMode({ existing: undefined, savedTraveler: {}, viewerUserId: 'u-son' })).toBe('edit')
  })

  it('계정 없는 여행자는 처음 입력한 사람만 고친다', () => {
    const existing = health('grandma', { enteredByUserId: 'u-son' })
    expect(healthEditMode({ existing, savedTraveler: {}, viewerUserId: 'u-son' })).toBe('edit')
    expect(healthEditMode({ existing, savedTraveler: {}, viewerUserId: 'u-daughter' })).toBe('readonly_entered')
  })

  it('화면에서만 "이 사람이 저예요"를 눌러 둔 것은 권한에 영향 없다 (서버 저장본이 기준)', () => {
    // 저장 전에는 서버가 아직 계정 없는 여행자로 보므로, 남이 처음 입력한 기록이 있으면 고칠 수 없다
    const existing = health('grandma', { enteredByUserId: 'u-son' })
    const savedBeforeClaim = { userId: undefined }
    expect(healthEditMode({ existing, savedTraveler: savedBeforeClaim, viewerUserId: 'u-me' })).toBe('readonly_entered')
  })
})
