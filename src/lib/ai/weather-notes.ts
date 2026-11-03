// 일정을 짜거나 다시 짤 때 AI에게 주는 날씨 참고 줄 (generate·revise 공용).
// 비·눈·폭염·한파인 날만 "실내 위주로"라고 한 줄 넣는다. 판정·걷는 시간은 엔진이 따로 계산하므로 이 줄은 장소 고르기 참고일 뿐이다.
import 'server-only'
import { weatherAiLine } from '@/lib/engine'
import type { AiDeps } from './deps'

// 날씨를 못 읽어도 일정 만들기를 막지 않는다 (예보는 덤이다). dayCount는 이번에 짜는 날 수
export async function readWeatherLine(
  deps: Pick<AiDeps, 'getWeather'>,
  dates: { date: string | null; endDate: string | null },
  dayCount: number,
): Promise<string | null> {
  if (!dates.date) return null
  try {
    const days = await deps.getWeather(dates)
    return weatherAiLine(
      days.filter(day => day.day <= dayCount),
      dayCount > 1,
    )
  } catch {
    console.warn('[ai] 날씨 예보를 못 읽었어요')
    return null
  }
}
