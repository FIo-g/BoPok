'use client'

// 장소 목록에서 고르기 (일정에 더하기·바꾸기). 이름 검색과 스타일 칩으로 좁힌다.
// 한 곳만 고르면 바로 닫히는 것이 기본이고(일정 화면), multi 를 주면 여러 곳을 고른 순서대로 모은 뒤 버튼을 눌러야 넘어간다(새 여행).
import { useState } from 'react'
import { api } from '@/lib/api-client'
import type { PlaceSummary } from '@/lib/contracts'
import { CONFIDENCE_TEXT, sourceLine } from '@/lib/format'
import { STYLE_OPTIONS } from '@/lib/trip-options'
import { errorMessage, useAsync } from '@/lib/use-async'
import { Badge, Button, Chip, Dialog, ErrorNotice, Spinner, TextInput } from '@/components/ui'

// 여러 곳 고르기. 고른 목록은 부르는 화면이 들고 있어서 창을 닫았다 다시 열어도 남는다
export type MultiPick = {
  picked: PlaceSummary[] // 고른 순서대로. 같은 곳을 또 넣을 수 있다 (일정 화면의 "또 넣기"와 같다)
  onChange: (picked: PlaceSummary[]) => void
  onDone: () => void // "N곳으로 일정 만들기"를 눌렀을 때만 부른다
  busy?: boolean
}

type Props = { title: string; usedIds: string[]; onClose: () => void } & (
  | { onPick: (place: PlaceSummary) => void; multi?: undefined }
  | { multi: MultiPick; onPick?: undefined }
)

function PickedFooter({ multi }: { multi: MultiPick }) {
  const { picked, onChange, onDone, busy = false } = multi
  const count = picked.length
  return (
    // 목록을 내려도 고른 장소와 만들기 버튼이 늘 보이게 창 아래에 붙인다 (창 안쪽 여백만큼 당겨 붙인다)
    <div className="sticky -bottom-6 -mx-6 -mb-6 mt-4 border-t border-line bg-surface px-6 pb-6 pt-4">
      <h3 className="text-lg font-extrabold" aria-live="polite">
        고른 장소 {count}곳
      </h3>
      {count === 0 ? (
        <p className="text-muted">위 목록에서 “넣기”를 눌러 주세요. 여러 곳을 고를 수 있고, 고른 순서대로 일정이 돼요.</p>
      ) : (
        <ol className="my-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto" aria-label="고른 장소 (고른 순서)">
          {picked.map((place, index) => (
            <li key={`${place.id}-${index}`} className="flex items-center gap-1 rounded-full border border-brand bg-brand-soft pl-4">
              <span className="font-bold">
                {index + 1}. {place.name}
              </span>
              <button
                type="button"
                className="min-h-12 rounded-full px-3 font-bold text-brand-strong underline disabled:opacity-50"
                aria-label={`${index + 1}번째 ${place.name} 빼기`}
                disabled={busy}
                onClick={() => onChange(picked.filter((_, i) => i !== index))}
              >
                빼기
              </button>
            </li>
          ))}
        </ol>
      )}
      <Button className="mt-2 w-full" disabled={count === 0 || busy} onClick={onDone}>
        {busy ? '저장하는 중…' : count > 0 ? `${count}곳으로 일정 만들기` : '일정 만들기'}
      </Button>
    </div>
  )
}

export function PlacePicker({ title, usedIds, onPick, multi, onClose }: Props) {
  const [q, setQ] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const places = useAsync(() => api.places.list({ q: q.trim() || undefined, styles }), `places:${q.trim()}:${styles.join(',')}`)

  function choose(place: PlaceSummary) {
    if (multi) multi.onChange([...multi.picked, place])
    else onPick?.(place)
  }

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
          {places.data.map(place => {
            const pickedCount = multi ? multi.picked.filter(p => p.id === place.id).length : 0
            const again = usedIds.includes(place.id) || pickedCount > 0
            return (
              <li key={place.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold">
                    {place.name}
                    {pickedCount > 0 && (
                      <Badge tone="brand" className="ml-2 align-middle">
                        ✓ 고름{pickedCount > 1 ? ` (${pickedCount}번)` : ''}
                      </Badge>
                    )}
                  </p>
                  <p className="text-muted">
                    {place.category}
                    {place.indoor ? ' · 실내' : ' · 야외'}
                    {place.visitMin !== undefined && ` · 약 ${place.visitMin}분 머물러요`}
                  </p>
                  <p className="text-sm text-muted">
                    {sourceLine(place.source, place.checkedAt)} · 신뢰 {place.confidence}({CONFIDENCE_TEXT[place.confidence]})
                  </p>
                </div>
                <Button
                  variant={multi && pickedCount > 0 ? 'secondary' : 'primary'}
                  onClick={() => choose(place)}
                  disabled={multi?.busy}
                  aria-label={multi ? `${place.name} ${again ? '또 넣기' : '넣기'}` : undefined}
                >
                  {multi ? (again ? '또 넣기' : '넣기') : again ? '또 넣기' : '고르기'}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-muted">맞는 장소가 없어요. 검색어나 스타일을 바꿔 보세요.</p>
      )}
      {multi && <PickedFooter multi={multi} />}
    </Dialog>
  )
}
