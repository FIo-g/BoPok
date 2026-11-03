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
// Andrews 2023 속도표에는 표본 평균 키가 없고 Pua 2022도 기준 키를 주지 않아(조사 B6), 한국 노인 평균 키를 쓴다.
// 사이즈코리아 2022 고령자 직접측정(70~84세 1,014명) 남 165.7·여 152.1 cm, 국민체력100(65세 이상 218,848명)
// 남 165.1·여 152.4 cm가 서로 맞아 반올림했다. 예전 임시값(여 158·남 171)은 6 cm 커서 속도를 약 0.04 m/s 높게 셌다.
export const HEIGHT_REF_CM = { female: 152, male: 165 }

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

// 계단 한 칸에 드는 시간 (초). Oh-Park, Wang, Verghese 2011 Arch Phys Med Rehabil 92(12):2006–2011 표 2:
// 70세 이상 지역사회 노인 513명(평균 80.8세), 높이 18 cm·깊이 26 cm 계단 3칸을 편한 속도로(필요하면 난간)
// 오르기 2.78±1.49초, 내려가기 2.83±1.61초. 구간 데이터에 오르는지 내려가는지가 없어 더 느린 내려가기를 쓴다.
// 계산: 2.83 ÷ 3 = 0.94. 한계: 3칸뿐이라 긴 계단의 피로는 못 담고, 출발 동작이 들어 있다 (조사 B1, 신뢰 B).
export const STAIR_STEP_SEC = 0.94
// '천천히'·보조기구 상한에 걸리는 사람(0.85 m/s 이하)은 같은 표의 평균+1SD를 쓴다: (2.83 + 1.61) ÷ 3 = 1.48.
// 느린 노인의 계단 시간을 따로 잰 자료가 없어서 고른 보수적인 값이다 (분포가 오른쪽으로 치우쳐 느린 사람이 많다).
export const STAIR_STEP_SEC_SLOW = 1.48
// 계단 한 칸의 수평 길이 (m). 장애인등편의법 시행규칙 [별표 1] 계단 "디딤판의 너비는 0.28미터 이상".
// 구간 거리에서 계단 부분을 빼고 평지로 걷는 시간을 셀 때 쓴다. 최솟값이라 평지 부분을 넉넉히(시간을 길게) 센다.
export const STAIR_TREAD_M = 0.28
// 계단 칸 수 기록이 없을 때만 걷는 시간에 곱하는 값. 시안 값, 임시 — 근거 없음.
// 칸 수를 알면 STAIR_STEP_SEC로 센다. 장소 데이터에 칸 수를 넣는 것이 먼저다.
export const STAIRS_WEIGHT = 2.0
// 경사 구간의 걷는 시간에 곱하는 값. 구간 데이터에는 경사 있음/없음만 있다.
// Shimotori 외 2026 JMIR Biomed Eng 11:e86036 표 2: 건강한 고령 20명(평균 64.2세) 평지 1.28 m/s,
// 7° 램프 오르막 1.08, 내리막 1.11 m/s → 시간 1.185배·1.153배(계산). 방향을 몰라 큰 쪽을 올려 1.2로 둔다.
// 한계: 7°(12.3%)는 법정 보도 기울기(1/18~1/12)보다 급하고, 3.25 m 짧은 램프·65세 직전 표본이다 (조사 B2, 신뢰 B).
// Tobler·Naismith는 노인 검증이 없고 내리막을 빠르게 보아 노인 실측과 반대라 쓰지 않는다.
export const SLOPE_WEIGHT = 1.2

// 걷는 시간 범위의 위쪽 끝 = 걷는 시간 × (1 + 여유율). 속도에서 빼지 않고 시간에 곱한다 —
// 느린 사람에게 같은 m/s를 빼면 지나치게 느려지기 때문이다. 근거(조사 B3, 신뢰 B):
// 실험실 vs 실생활 속도 차 Thi My Lien 외 2026 Gait Posture 메타분석 0.22 m/s(95% CI 0.09–0.35),
// Takayanagi 외 2019 Sci Rep 117.0 vs 109.7 cm/s(시간 1.07배), Lindemann 외 2021 8 m 1.21 vs 400 m 1.14 m/s(1.06배),
// 400 m 후반 6.5% 넘게 느려지는 사람 23%(Simonsick 외 2014). 0.2는 이것들의 위쪽을 덮는 보수적인 값이다.
export const MARGIN_RATE = 0.2

// '잘 모르겠어요'를 뺀 비교에서 부모님 답의 비중. 나머지 0.2는 다른 사람 답.
// 설계 7.1.1 (김태형 10/30)
export const PARENT_WEIGHT = 0.8

// 여행자가 조건 칸을 비워 두면 엔진이 쓰는 기본값 (설계 7.1.2 기본값과 같다).
// 쉬지 않고 걷기는 나이·보조기구에 따라 더 짧게 본다 (CONTINUOUS_DEFAULT_BY_AGE). 여기 20분은 74세까지·나이 모름의 값이다
export const DEFAULT_CONDITION: Readonly<Condition> = {
  continuousMin: 20, // 쉬지 않고 걷기: 동네 마트까지
  dayMin: 60, // 하루 총 걷기: 시장 장보기
  restMin: 10, // 한 번 쉬는 시간: 차 한 잔 정도
  avoidStairs: true, // 계단은 기본으로 피하기
}

// 쉬지 않고 걷기 기본값을 나이에 맞춘다 (설계 7.1.2, 김태형 11/3 결정 — 근거 노트 B4).
// 2023 노인실태조사(N=10,078): "300 m 이동이 힘들다" 70–74세 13.9%, 75–79세 24.2%, 80–84세 37.0% (신뢰 A).
// 15·10분이라는 숫자 자체는 판단이다(신뢰 C) — 답이 없을 때만 쓰는 안전한 쪽 기본값이라 받아들였다.
export const CONTINUOUS_DEFAULT_BY_AGE: readonly { minAge: number; continuousMin: number }[] = [
  { minAge: 75, continuousMin: 15 },
  { minAge: 85, continuousMin: 10 },
]
// 지팡이·보행기를 쓰면 나이와 상관없이 이 값
export const CONTINUOUS_DEFAULT_MOBILITY_AID_MIN = 10
