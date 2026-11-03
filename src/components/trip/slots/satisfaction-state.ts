// 일차별 만족도 칸의 판단. 화면 없이 테스트할 수 있게 따로 둔다.
import { dayDate } from '@/lib/plan/trip-days'

// 이 기기의 오늘 날짜 'YYYY-MM-DD'. toISOString()은 UTC라 한국 오전에 하루 밀린다
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// 그날이 왔는지. 여행 당일 저녁에도 남길 수 있게 그날부터 묻는다. 날짜가 없는 여행은 묻지 않는다
export function dayHasArrived(startDate: string | null | undefined, day: number, today: string): boolean {
  const date = dayDate(startDate, day)
  return date !== null && date <= today
}

export function feedbackQuestion(startDate: string | null | undefined, day: number, today: string): string {
  return dayDate(startDate, day) === today ? '오늘 어떠셨어요?' : `${day}일차는 어떠셨어요?`
}
