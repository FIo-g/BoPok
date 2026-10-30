// 보행 계산 엔진의 상수 모음. 판정·속도 계산은 이 값을 벗어나 쓰지 않는다 (설계 7.1).
// 연구 값은 4~10 m 실험실 측정이라 실제 길보다 빠르다는 한계가 있다(노션 조사 4.7) → 여유율(MARGIN_RATE)로 보완한다.
import type { Condition } from '@/lib/contracts'

// 편한 속도 기준 성인 남녀 (m/s). minAge는 이 나이부터 현재 표의 다음 minAge 직전까지.
// Andrews 외 2023 J Physiother 표 2 (성인 51,248명 메타분석, cm/s ÷ 100으로 환산)
export const ADULT_SPEED_TABLE: readonly { minAge: number; femaleMps: number; maleMps: number }[] = [
  { minAge: 18, femaleMps: 1.38, maleMps: 1.36 },
  { minAge: 30, femaleMps: 1.38, maleMps: 1.39 },
  { minAge: 40, femaleMps: 1.34, maleMps: 1.4 },
  { minAge: 50, femaleMps: 1.25, maleMps: 1.34 },
  { minAge: 60, femaleMps: 1.21, maleMps: 1.26 },
  { minAge: 70, femaleMps: 1.13, maleMps: 1.2 },
  { minAge: 80, femaleMps: 0.97, maleMps: 1.05 },
]

// 아동·청소년 평균 속도 (m/s). 1 km 걷는 시간을 속도로 바꾼 값. 성별 구분과 키 보정은 하지 않는다 (김태형 10/30).
// 0세: 채정병 외 2008 유아 89.48 cm/s / 5세 이상: Voss 외 2020 (1 km 시간 환산)
export const CHILD_SPEED_TABLE: readonly { minAge: number; speedMps: number }[] = [
  { minAge: 0, speedMps: 0.89 }, // 5세 미만
  { minAge: 5, speedMps: 1.11 }, // 1 km 15.0분
  { minAge: 7, speedMps: 1.19 }, // 14.0분
  { minAge: 9, speedMps: 1.25 }, // 13.3분
  { minAge: 11, speedMps: 1.34 }, // 12.4분
  { minAge: 14, speedMps: 1.28 }, // Voss 외 2020 14~21세, 13.0분
]

// 성인 속도표가 적용되는 최소 나이 (아동 표와의 경계)
export const ADULT_MIN_AGE = 18

// 키 보정의 기준 키 (cm). 이보다 크면 가산·작으면 감산.
// 임시: 설계 제안값, 한국 평균 키에 맞춤 — 근거 있는 연구 값 아님
export const HEIGHT_REF_CM = { female: 158, male: 171 }

// 키 1 cm당 속도 보정량 (m/s). 18세 이상만 적용한다.
// Pua 외 2022 (싱가포르 노인): 키 10 cm당 0.07 m/s
export const HEIGHT_MPS_PER_CM = 0.007

// 키 보정의 상한 (m/s). 키 큰 사람의 속도 이점이 나이가 들수록 사라진다 → 무제한 보정 방지.
// Elbaz 외 2018
export const HEIGHT_ADJUST_CAP_MPS = 0.1

// '천천히 걸어요'일 때 이 값(m/s) 이하로 제한한다.
// 한음 외 2020 (한국 고령 보행자 하위 15%)
export const SLOW_CAP_MPS = 0.85

// 보행 보조기구(지팡이·휠체어) 사용 시 이 값(m/s) 이하로 제한한다. '천천히'와 둘 다면 이 값(더 작음).
// 한음 외 2020 — 초록 값 0.73이며 본문에는 0.70으로 나온다. 설계 7.1대로 초록 값을 쓴다.
export const MOBILITY_AID_CAP_MPS = 0.73

// 나이를 모르는 여행자의 속도 (m/s). 부모님 쪽으로 안전하게 '천천히'와 같은 값으로 본다 (설계 7.1).
export const UNKNOWN_AGE_SPEED_MPS = 0.85

// 계단 구간의 걷는 시간에 곱하는 값 (설계 7.2). 시안 값, 임시 — 근거 없음
export const STAIRS_WEIGHT = 2.0
// 경사 구간의 걷는 시간에 곱하는 값 (설계 7.2). 시안 값, 임시 — 근거 없음
export const SLOPE_WEIGHT = 1.5

// 걷는 시간 범위의 위쪽 끝 = 걷는 시간 × (1 + 여유율). 설계 7.2 — 개인차가 커서 시안 0.1보다 넓혔다.
export const MARGIN_RATE = 0.2

// '잘 모르겠어요'를 뺀 비교에서 부모님 답의 비중. 나머지 0.2는 다른 사람 답.
// 설계 7.1.1 (김태형 10/30)
export const PARENT_WEIGHT = 0.8

// 여행자가 조건 칸을 비워 두면 엔진이 쓰는 기본값 (설계 7.1.2 기본값과 같다).
export const DEFAULT_CONDITION: Readonly<Condition> = {
  continuousMin: 20, // 쉬지 않고 걷기: 동네 마트까지
  dayMin: 60, // 하루 총 걷기: 시장 장보기
  restMin: 10, // 한 번 쉬는 시간: 차 한 잔 정도
  avoidStairs: true, // 계단은 기본으로 피하기
}
