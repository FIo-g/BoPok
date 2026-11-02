// 일정 화면의 기능별 빈 자리가 받는 입력 (설계 2026-11-02 6.5).
// 일정 화면은 이 모양만 넘기고, 각 기능 담당은 자기 slot 파일만 고친다 (AGENTS 3장) — 같은 파일 충돌을 막기 위해서다.
import type { JudgeResult, Stop, Traveler } from '@/lib/contracts'

export type TripSlotProps = {
  tripId: string
  day: number // 고른 날 (1부터)
  stops: Stop[] // 고른 날의 장소, 저장된 순서 그대로 (직접 고치는 중이면 고치는 중인 일정)
  result: JudgeResult | null // 고른 날의 판정. 아직 계산 전이거나 함께 가는 사람이 없으면 null
  travelers: Traveler[]
  versionId: string | null // 보고 있는 버전. 일정이 아직 없으면 null
  userId: string // 로그인한 사람
}
