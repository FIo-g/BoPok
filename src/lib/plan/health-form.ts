// 건강 정보 입력 폼의 순수 도우미 (React·fetch 없음). 칩 고르기, 저장 요청 만들기, 목록 갱신, 고칠 수 있는지 가르기.
// 건강 값은 민감정보라서 이 파일 어디에서도 로그를 남기지 않는다.
import {
  canEditHealth,
  type HealthCondition,
  type HealthVisibility,
  type MedicationClass,
  type Traveler,
  type TravelerHealth,
  type TravelerHealthInput,
} from '@/lib/contracts'

export type HealthFormState = {
  conditions: HealthCondition[]
  medicationClasses: MedicationClass[]
  visibility: HealthVisibility
  consent: boolean
}

// 처음엔 "본인만" 보이게 둔다 (설계 4.4 — 더 넓게 여는 쪽은 사람이 직접 고른다).
// 동의는 고칠 때마다 다시 받으므로 저장된 기록이 있어도 false 로 시작한다.
export function initialHealthForm(existing: TravelerHealth | undefined): HealthFormState {
  if (!existing) return { conditions: [], medicationClasses: [], visibility: 'self', consent: false }
  return {
    conditions: [...existing.conditions],
    medicationClasses: [...existing.medicationClasses],
    visibility: existing.visibility,
    consent: false,
  }
}

// 있으면 빼고 없으면 넣는다. 결과는 항상 order(스키마 options) 순서 — 어떤 순서로 눌러도 같은 고르기는 같은 값이라
// 저장된 값과 폼 값을 비교하거나 테스트하기 쉽다. order 에 없는 값은 맨 뒤로 보낸다.
export function toggleIn<T>(list: readonly T[], value: T, order: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  const rank = (item: T) => {
    const index = order.indexOf(item)
    return index === -1 ? order.length : index
  }
  return next.sort((a, b) => rank(a) - rank(b))
}

// 동의가 없으면 요청 자체를 만들지 않는다 (서버도 consent: true 가 없으면 400 이지만 화면에서 먼저 막는다)
export function healthFormInput(state: HealthFormState): TravelerHealthInput | null {
  if (!state.consent) return null
  return {
    conditions: [...state.conditions],
    medicationClasses: [...state.medicationClasses],
    visibility: state.visibility,
    consent: true,
  }
}

// 고른 병·약이 없어도 저장할 수 있다 ("해당하는 것이 없다"는 것도 본인이 정한 값이다)
export const canSubmitHealth = (state: HealthFormState, busy: boolean): boolean => state.consent && !busy

// 저장 응답을 목록에 반영: 같은 여행자는 제자리에서 바꾸고, 없던 여행자는 뒤에 더한다
export function upsertHealthList(list: readonly TravelerHealth[], saved: TravelerHealth): TravelerHealth[] {
  const found = list.some(item => item.travelerId === saved.travelerId)
  return found ? list.map(item => (item.travelerId === saved.travelerId ? saved : item)) : [...list, saved]
}

export const removeHealthFromList = (list: readonly TravelerHealth[], travelerId: string): TravelerHealth[] =>
  list.filter(item => item.travelerId !== travelerId)

// 여행자 카드의 편집기가 어떤 모습이어야 하는지.
// - unsaved: 서버에 아직 없는 여행자 (건강 정보는 여행자가 저장된 뒤에야 받을 수 있다)
// - edit: 내가 입력·고치기·지우기를 할 수 있다
// - readonly_linked: 계정이 연결된 분이라 그분이 직접 입력한다
// - readonly_entered: 계정이 없는 분인데 다른 가족이 처음 입력했다
// savedTraveler 는 서버에 저장된 여행자여야 한다. 화면에서 "이 사람이 저예요"만 눌러 두고 저장 전이면
// 서버는 아직 옛 연결 상태로 권한을 검사하므로, 화면 초안(draft)으로 가르면 버튼은 열리는데 저장은 403 이 된다.
export function healthEditMode(args: {
  existing: TravelerHealth | undefined
  savedTraveler: Pick<Traveler, 'userId'> | undefined
  viewerUserId: string
}): 'unsaved' | 'edit' | 'readonly_linked' | 'readonly_entered' {
  const { existing, savedTraveler, viewerUserId } = args
  if (!savedTraveler) return 'unsaved'
  if (canEditHealth(existing ?? null, viewerUserId, savedTraveler.userId ?? null)) return 'edit'
  return savedTraveler.userId !== undefined ? 'readonly_linked' : 'readonly_entered'
}
