'use client'

// 확정 일정: 최종 일정, 지도, 가족에게 보내기(공유 글). 공유는 Web Share API, 안 되면 복사하기.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireUser } from '@/components/AuthProvider'
import { TripMap } from '@/components/trip/TripMap'
import { useJudged } from '@/components/trip/useJudged'
import { Badge, Button, ButtonLink, Card, ErrorNotice, Notice, PageTitle, Spinner, VerdictBadge } from '@/components/ui'
import { api } from '@/lib/api-client'
import { formatRange } from '@/lib/engine'
import { TRANSPORT_TEXT, copyText, formatDate, madeByText, shareOrCopy, versionLabel } from '@/lib/format'
import { errorMessage, useAsync } from '@/lib/use-async'

export function FinalScreen({ tripId }: { tripId: string }) {
  const user = useRequireUser()
  const enabled = user !== null
  const detail = useAsync(() => api.trips.get(tripId), `final:${tripId}:${user?.id}`, enabled)
  const confirmedId = detail.data?.trip.confirmedVersionId ?? null
  const version = useAsync(() => api.trips.getVersion(tripId, confirmedId ?? ''), `final-ver:${tripId}:${confirmedId}`, enabled && confirmedId !== null)
  const share = useAsync(() => api.trips.shareText(tripId), `share:${tripId}:${confirmedId}`, enabled && confirmedId !== null)
  const judged = useJudged(version.data?.stops, detail.data?.travelers)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const mapData = useMemo(() => (judged && version.data ? { stops: version.data.stops, places: judged.places, legs: judged.legs, result: judged.result } : null), [judged, version.data])

  if (!user || detail.loading) return <Spinner />
  if (detail.error || !detail.data) return <div className="mx-auto max-w-3xl px-5 py-8"><ErrorNotice message={errorMessage(detail.error)} onRetry={detail.reload} /></div>
  const { trip } = detail.data
  if (!confirmedId) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-8">
        <PageTitle title={trip.title} />
        <Notice tone="info">아직 확정된 일정이 없어요. 일정 화면에서 마음에 드는 안을 “이 안으로 확정”해 주세요.</Notice>
        <div className="mt-4"><ButtonLink href={`/trips/${tripId}`}>일정 보러 가기</ButtonLink></div>
      </div>
    )
  }

  const summary = detail.data.versions.find(v => v.id === confirmedId)
  const text = share.data?.text ?? ''

  async function send() {
    const how = await shareOrCopy(text, `[보폭] ${trip.title}`)
    setNotice(how === 'failed' ? { tone: 'warn', text: '보내지 못했어요. 아래 글을 길게 눌러 직접 복사해 주세요' } : { tone: 'ok', text: how === 'copied' ? '복사했어요. 가족 단체방에 붙여 넣어 주세요' : '보냈어요' })
  }
  async function copy() {
    setNotice((await copyText(text)) ? { tone: 'ok', text: '복사했어요. 가족 단체방에 붙여 넣어 주세요' } : { tone: 'warn', text: '복사하지 못했어요. 아래 글을 길게 눌러 직접 복사해 주세요' })
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] px-5 py-6">
      <PageTitle
        title={trip.title}
        sub={`${formatDate(trip.date)} · ${summary ? `${versionLabel(summary)} · ${madeByText(summary)}` : ''}${trip.confirmedByName ? ` · ${trip.confirmedByName}님이 확정했어요` : ''}`}
        actions={
          <>
            <Link href={`/groups/${trip.groupId}`} className="inline-flex min-h-12 items-center rounded-xl px-4 font-bold text-muted hover:bg-black/5">← 그룹으로</Link>
            <ButtonLink href={`/trips/${tripId}`} variant="secondary">일정 화면에서 고치기</ButtonLink>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
          {judged && version.data ? (
            <>
              <Card className="flex flex-wrap items-center gap-3">
                <Badge tone="ok">✓ 확정</Badge>
                <VerdictBadge verdict={judged.result.verdict} />
                <p className="text-lg font-bold">
                  하루 걷기 {formatRange(judged.result.day)} · 쉬지 않고 걷는 시간 최대 {formatRange(judged.result.longest)} <span className="text-sm font-semibold text-muted">추정치</span>
                </p>
              </Card>
              <Card>
                <ol className="divide-y divide-line">
                  {version.data.stops.map((stop, index) => {
                    const stopResult = judged.result.stops.find(s => s.stopKey === stop.key)
                    const leg = judged.result.legs.find(l => l.fromStopKey === stop.key)
                    const place = stop.placeId ? judged.places[stop.placeId] : undefined
                    const rests = stop.restNodeIds.map(id => place?.nodes.find(n => n.id === id)).filter((n): n is NonNullable<typeof n> => Boolean(n))
                    return (
                      <li key={stop.key} className="grid grid-cols-[4.5rem_1fr] gap-3 py-4">
                        <time className="text-lg font-extrabold text-brand-strong">{stop.startTime ?? '--:--'}</time>
                        <div>
                          <h2 className="text-xl font-extrabold">{index + 1}. {stop.name}</h2>
                          <p className="text-muted">
                            {stop.visitMin !== undefined && `약 ${stop.visitMin}분 머물러요`}
                            {stop.reservedAt && ` · 예약 ${stop.reservedAt}`}
                          </p>
                          <p className="text-muted">
                            {stopResult?.known ? `걷기 ${formatRange(stopResult.walk)} · 추정치` : '길 정보 없음'}
                            {rests.map(n => ` · ${n.name}${n.restType === 'indoor' ? '(실내)' : n.restType === 'outdoor' ? '(야외)' : ''}에서 쉬기`).join('')}
                          </p>
                          {place?.phone && <p className="text-sm text-muted">연락처 {place.phone}</p>}
                          {leg && <p className="mt-1 font-semibold">↓ {TRANSPORT_TEXT[leg.mode]}{leg.rideMin !== null ? ` 약 ${Math.round(leg.rideMin)}분` : leg.walkTime ? ` 걷기 ${formatRange(leg.walkTime)}` : ''}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </Card>
              <Notice tone="warn">출발 전에 각 장소의 운영 여부를 꼭 확인하세요. 걷는 시간은 모두 추정치예요.</Notice>
            </>
          ) : version.error ? (
            <ErrorNotice message={errorMessage(version.error)} onRetry={version.reload} />
          ) : (
            <Spinner label="일정을 불러오는 중이에요" />
          )}

          <Card className="flex flex-col gap-3">
            <h2 className="text-xl font-extrabold">가족에게 보내기</h2>
            {share.error && <ErrorNotice message={errorMessage(share.error)} onRetry={share.reload} />}
            {share.loading ? <Spinner label="공유 글을 만드는 중이에요" /> : (
              <>
                <pre className="whitespace-pre-wrap rounded-xl bg-canvas p-4 font-sans text-base leading-relaxed" aria-label="공유할 글">{text}</pre>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={send}>가족에게 보내기</Button>
                  <Button variant="secondary" onClick={copy}>글 복사하기</Button>
                </div>
              </>
            )}
            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          </Card>
        </div>
        <div className="order-1 lg:sticky lg:top-24 lg:order-2">
          <TripMap data={mapData} selectedId={selectedId} onSelect={setSelectedId} className="h-80 lg:h-[calc(100vh-8rem)]" />
        </div>
      </div>
    </div>
  )
}
