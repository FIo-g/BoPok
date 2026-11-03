'use client'

// 날씨: 고른 날의 기상청 예보(대전 기준). 폭염은 경고로 눈에 띄게, 비·눈·추위·바람은 여행 준비 안내로 — 담당 김태형.
// 판정(걷기 조건)은 바꾸지 않는다. 이 카드는 덤이라 불러오는 중이거나 실패해도 일정 화면을 막지 않는다.
// 담당은 이 파일만 고친다. 일정 화면(TripScreen)에는 연결하는 한 줄만 있다.
import { useMemo } from 'react'
import { Badge, Card, Notice } from '@/components/ui'
import { api } from '@/lib/api-client'
import type { WeatherCaution } from '@/lib/contracts'
import { weatherSlotView } from '@/lib/plan/weather-view'
import { useAsync } from '@/lib/use-async'
import type { TripSlotProps } from './types'

function Tips({ tips }: { tips: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-6">
      {tips.map(tip => (
        <li key={tip}>{tip}</li>
      ))}
    </ul>
  )
}

function WarningBox({ caution }: { caution: WeatherCaution }) {
  return (
    <Notice tone="warn">
      <p className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
        <Badge tone="warn" className="border border-current">
          <span aria-hidden="true">⚠</span>
          경고
        </Badge>
        {caution.title}
      </p>
      <Tips tips={caution.tips} />
    </Notice>
  )
}

function PrepBox({ caution }: { caution: WeatherCaution }) {
  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <p className="flex flex-wrap items-center gap-2 font-bold">
        <Badge tone="info">
          <span aria-hidden="true">✓</span>
          준비
        </Badge>
        {caution.title}
      </p>
      <Tips tips={caution.tips} />
    </li>
  )
}

export function WeatherSlot({ tripId, userId, day, stops, places }: TripSlotProps) {
  const weather = useAsync(() => api.weather.get(tripId), `weather:${tripId}`, userId !== '')
  const view = useMemo(() => (weather.data ? weatherSlotView({ weather: weather.data, day, stops, places }) : null), [weather.data, day, stops, places])

  // 불러오는 중에는 자리를 차지하지 않는다. 실패하면 한 줄만 알린다
  if (weather.error) {
    return (
      <Card>
        <h2 className="text-xl font-extrabold">날씨</h2>
        <p className="text-muted">지금은 날씨 예보를 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.</p>
      </Card>
    )
  }
  if (!view || view.kind === 'hidden') return null

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xl font-extrabold">날씨 · 여행 준비</h2>
      {view.kind === 'no_date' && <p className="text-muted">여행 날짜를 정하면 날씨 예보를 보여 드려요.</p>}
      {view.kind === 'message' && <p className="text-muted">{view.text}</p>}
      {view.kind === 'forecast' && (
        <>
          <p className="text-lg font-bold">{view.summary || '예보 내용이 비어 있어요'}</p>
          {view.warnings.map(caution => (
            <WarningBox key={caution.kind} caution={caution} />
          ))}
          {view.preps.length > 0 ? (
            <ul className="grid gap-3">
              {view.preps.map(caution => (
                <PrepBox key={caution.kind} caution={caution} />
              ))}
            </ul>
          ) : (
            view.warnings.length === 0 && <p className="text-muted">특별히 챙길 날씨 안내는 없어요. 떠나기 전에 예보를 한 번 더 확인해 주세요.</p>
          )}
          <p className="text-sm text-muted">{view.sourceLine}</p>
        </>
      )}
    </Card>
  )
}
