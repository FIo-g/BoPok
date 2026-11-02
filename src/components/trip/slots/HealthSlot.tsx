'use client'

// ② 건강 정보·식단 주의: 그날 식당 메뉴 주의 표시 (보이는 범위는 canSeeHealth) — 담당 김태형 (설계 2026-11-02 6.2).
// 담당은 이 파일만 고친다. 일정 화면(TripScreen)은 고치지 않아도 된다.
//
// 서버가 보는 사람에 맞춰 이미 거른 건강 정보만 받아서 그 안에서 계산한다. 받은 것이 없으면 아무것도 그리지 않는다 —
// "본인만"으로 둔 가족의 화면에는 건강 정보가 있다는 사실도 비치지 않아야 하기 때문이다.
// 이 카드는 덤이다: 불러오는 중이거나 실패해도 일정 화면을 막지 않고, 건강 값은 로그에 남기지 않는다.
import Link from 'next/link'
import { useMemo } from 'react'
import { Badge, Card, Notice } from '@/components/ui'
import { api } from '@/lib/api-client'
import { DIET_RULES } from '@/lib/engine'
import { healthSlotView, type HealthCautionRow } from '@/lib/plan/health-view'
import { useAsync } from '@/lib/use-async'
import type { TripSlotProps } from './types'

type PlaceGroup = { stopKey: string; placeName: string; rows: HealthCautionRow[] }

// 엔진이 장소 순서대로 준 줄을 장소별로 묶는다. 같은 장소의 줄은 이어서 오므로 앞 묶음과 키가 같으면 붙인다.
function groupByPlace(rows: HealthCautionRow[]): PlaceGroup[] {
  const groups: PlaceGroup[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.stopKey === row.stopKey) last.rows.push(row)
    else groups.push({ stopKey: row.stopKey, placeName: row.placeName, rows: [row] })
  }
  return groups
}

export function HealthSlot(props: TripSlotProps) {
  const { tripId, userId, stops, places, travelers } = props
  const health = useAsync(() => api.health.list(tripId), `health:${tripId}:${userId}`, userId !== '')
  const view = useMemo(
    () => (health.data ? healthSlotView({ health: health.data, stops, places, travelers, rules: DIET_RULES }) : null),
    [health.data, stops, places, travelers],
  )

  if (!view || view.kind === 'hidden') return null

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">식단 주의 (참고)</h2>
        <Link href={`/trips/${tripId}/travelers`} className="inline-flex min-h-12 items-center font-bold text-brand-strong underline">
          건강 정보 고치기 →
        </Link>
      </div>
      <p className="text-muted">의학적 조언이 아니에요. 의사·약사와 상의해 주세요</p>

      {view.kind === 'no_menus' && <Notice tone="info">이날 일정에는 메뉴 정보가 있는 곳이 없어 식단 주의를 확인하지 못했어요 (참고용)</Notice>}
      {view.kind === 'no_cautions' && <Notice tone="info">등록된 주의 정보 없음 (참고용) — 주의 규칙 표에 있는 조합만 알려 드려요</Notice>}
      {view.kind !== 'no_menus' && view.uncheckedMeals.length > 0 && (
        <Notice tone="info">메뉴 정보가 없어 확인하지 못한 식사 자리: {view.uncheckedMeals.join(', ')}</Notice>
      )}
      {view.kind === 'cautions' && (
        <div className="flex flex-col gap-4">
          {groupByPlace(view.rows).map(group => (
            <section key={group.stopKey} className="flex flex-col gap-2">
              <h3 className="text-lg font-extrabold">{group.placeName}</h3>
              <ul className="grid gap-3">
                {group.rows.map((row, index) => (
                  <li key={index} className="rounded-xl border border-line bg-white p-4">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      <Badge tone="warn">
                        <span aria-hidden="true">!</span>
                        주의
                      </Badge>
                      {[row.travelerLabel, row.menuName, row.foodTagLabel].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-2">
                      {row.reason}: {row.sentence}
                    </p>
                    {row.partialMedication && <p className="mt-1 font-bold text-warn">일부 약만 해당돼요 — 의사·약사에게 확인하세요</p>}
                    <p className="mt-1 text-sm text-muted">
                      출처: {row.source} · 확인 {row.checkedAt}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}
