'use client'

// 장소 목록에서 고르기 (일정에 더하기·바꾸기). 이름 검색과 스타일 칩으로 좁힌다.
import { useState } from 'react'
import { api } from '@/lib/api-client'
import type { PlaceSummary } from '@/lib/contracts'
import { CONFIDENCE_TEXT, sourceLine } from '@/lib/format'
import { STYLE_OPTIONS } from '@/lib/trip-options'
import { errorMessage, useAsync } from '@/lib/use-async'
import { Button, Chip, Dialog, ErrorNotice, Spinner, TextInput } from '@/components/ui'

export function PlacePicker({ title, usedIds, onPick, onClose }: { title: string; usedIds: string[]; onPick: (place: PlaceSummary) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const places = useAsync(() => api.places.list({ q: q.trim() || undefined, styles }), `places:${q.trim()}:${styles.join(',')}`)

  return (
    <Dialog title={title} onClose={onClose}>
      <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="장소 이름으로 찾기" aria-label="장소 이름 검색" />
      <div className="my-3 flex flex-wrap gap-2">
        {STYLE_OPTIONS.map(style => (
          <Chip key={style} selected={styles.includes(style)} onClick={() => setStyles(cur => (cur.includes(style) ? cur.filter(s => s !== style) : [...cur, style]))}>
            {style}
          </Chip>
        ))}
      </div>
      {places.error && <ErrorNotice message={errorMessage(places.error)} onRetry={places.reload} />}
      {places.loading ? (
        <Spinner />
      ) : places.data && places.data.length > 0 ? (
        <ul className="space-y-2">
          {places.data.map(place => (
            <li key={place.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold">{place.name}</p>
                <p className="text-muted">
                  {place.category}
                  {place.indoor ? ' · 실내' : ' · 야외'}
                  {place.visitMin !== undefined && ` · 약 ${place.visitMin}분 머물러요`}
                </p>
                <p className="text-sm text-muted">
                  {sourceLine(place.source, place.checkedAt)} · 신뢰 {place.confidence}({CONFIDENCE_TEXT[place.confidence]})
                </p>
              </div>
              <Button onClick={() => onPick(place)}>{usedIds.includes(place.id) ? '또 넣기' : '고르기'}</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-muted">맞는 장소가 없어요. 검색어나 스타일을 바꿔 보세요.</p>
      )}
    </Dialog>
  )
}
