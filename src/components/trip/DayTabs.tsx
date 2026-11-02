'use client'

// 여러 날 여행의 날짜 탭 (설계 2026-11-02 6.5). 하루짜리 여행이면 그리지 않아 지금 화면과 같다.
// 상태는 색만이 아니라 ✓ 표시와 글자로도 구분한다 (AGENTS 6장).
import { Chip } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { dayDate } from '@/lib/plan/trip-days'

// '2026년 11월 14일 (토)' → '11월 14일 (토)' (탭이 좁아서 연도는 뺀다)
function shortDate(ymd: string | null): string | null {
  return ymd ? formatDate(ymd).replace(/^\d{4}년 /, '') : null
}

export function DayTabs({ days, day, startDate, onSelect, disabled }: { days: number[]; day: number; startDate?: string | null; onSelect: (day: number) => void; disabled?: boolean }) {
  if (days.length <= 1) return null
  return (
    <nav aria-label="날짜별 일정" className="flex flex-wrap gap-2">
      {days.map(d => {
        const date = shortDate(dayDate(startDate, d))
        return (
          <Chip key={d} selected={d === day} onClick={() => onSelect(d)} disabled={disabled}>
            {d}일차{date ? ` · ${date}` : ''}
          </Chip>
        )
      })}
    </nav>
  )
}
