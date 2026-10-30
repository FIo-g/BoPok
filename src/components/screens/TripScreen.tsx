'use client'

// 일정 화면 (서비스의 중심): 왼쪽 일정·판정·의견·버전, 오른쪽 지도 (1:1). 좁은 화면에서는 지도를 위, 일정을 아래로 쌓는다.
// 일정(stops)이 바뀔 때마다 브라우저에서 엔진으로 바로 다시 판정하고(useJudged) 지도와 목록이 같이 바뀐다.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireUser } from '@/components/AuthProvider'
import { ConditionTuner } from '@/components/trip/ConditionTuner'
import { JudgePanel } from '@/components/trip/JudgePanel'
import { OpinionForm, OpinionList } from '@/components/trip/OpinionBox'
import { PlacePicker } from '@/components/trip/PlacePicker'
import { QuickFixPanel } from '@/components/trip/QuickFixPanel'
import { StopList, type StopEditing } from '@/components/trip/StopList'
import { TripMap } from '@/components/trip/TripMap'
import { useJudged } from '@/components/trip/useJudged'
import { VersionBar, VersionCompare } from '@/components/trip/VersionBar'
import { Button, Card, ErrorNotice, Notice, PageTitle, Spinner } from '@/components/ui'
import { api, isApiError } from '@/lib/api-client'
import type { Condition, OpinionInput, PlaceSummary, QuickFix, Stop } from '@/lib/contracts'
import { fixedChangeSentence } from '@/lib/engine'
import { formatDate } from '@/lib/format'
import { moveStop, removeStop, replaceStopPlace, sameStops, stopFromPlace, updateStop } from '@/lib/plan/stop-edit'
import { errorMessage, useAsync } from '@/lib/use-async'

const OPINION_REFRESH_MS = 15_000

type Picker = { mode: 'add' } | { mode: 'replace'; key: string } | null

export function TripScreen({ tripId }: { tripId: string }) {
  const user = useRequireUser()
  const router = useRouter()
  const enabled = user !== null
  const detail = useAsync(() => api.trips.get(tripId), `trip:${tripId}:${user?.id}`, enabled)
  const [chosenId, setChosenId] = useState<string | null>(null)

  const versions = detail.data?.versions
  // 처음 열면 확정된 안, 없으면 가장 최근 안
  const activeId = chosenId ?? detail.data?.trip.confirmedVersionId ?? versions?.[versions.length - 1]?.id ?? null
  const version = useAsync(() => api.trips.getVersion(tripId, activeId ?? ''), `ver:${tripId}:${activeId}`, enabled && activeId !== null)
  const parentId = versions?.find(v => v.id === activeId)?.parentId ?? null
  const parent = useAsync(() => api.trips.getVersion(tripId, parentId ?? ''), `ver:${tripId}:${parentId}`, enabled && parentId !== null)
  const opinions = useAsync(() => api.opinions.list(activeId ?? ''), `op:${activeId}`, enabled && activeId !== null)

  // 직접 고치는 중이면 draft 가 있다. 저장하기 전에는 새 버전이 아니다
  const [draft, setDraft] = useState<Stop[] | null>(null)
  const [tuned, setTuned] = useState<Partial<Condition> | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [picker, setPicker] = useState<Picker>(null)
  const [showQuickFix, setShowQuickFix] = useState(false)
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState<null | 'save' | 'revise' | 'confirm'>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'info'; text: string } | null>(null)

  const travelers = detail.data?.travelers
  const stops = draft ?? version.data?.stops
  const judged = useJudged(stops, travelers, tuned)
  const prevJudged = useJudged(parent.data?.stops, travelers, tuned)
  const dirty = draft !== null && version.data !== undefined && !sameStops(draft, version.data.stops)

  // 열어 둔 동안 새 의견을 몇 초마다 다시 받아 온다 (설계 5장)
  const reloadOpinions = opinions.reload
  useEffect(() => {
    const timer = setInterval(reloadOpinions, OPINION_REFRESH_MS)
    return () => clearInterval(timer)
  }, [reloadOpinions])

  const stopNames = useMemo(() => Object.fromEntries((stops ?? []).map(stop => [stop.key, stop.name])), [stops])
  const mapData = useMemo(() => (judged && stops ? { stops, places: judged.places, legs: judged.legs, result: judged.result } : null), [judged, stops])

  function chooseVersion(id: string) {
    if (dirty && !window.confirm('고치던 내용이 저장되지 않았어요. 버리고 다른 안을 볼까요?')) return
    setDraft(null)
    setSelectedId(null)
    setShowQuickFix(false)
    setMessage(null)
    setChosenId(id)
  }

  async function afterNewVersion(id: string, text: string) {
    setDraft(null)
    setSelectedId(null)
    setShowQuickFix(false)
    setChosenId(id)
    detail.reload()
    setMessage({ tone: 'ok', text })
  }

  async function saveDraft() {
    if (!draft || !activeId) return
    setBusy('save')
    setMessage(null)
    try {
      const saved = await api.trips.saveVersion(tripId, { parentId: activeId, stops: draft, madeBy: 'user', note: null })
      await afterNewVersion(saved.id, `${saved.number}번째 안으로 저장했어요`)
    } catch (e) {
      setMessage({ tone: 'warn', text: errorMessage(e) })
    }
    setBusy(null)
  }

  async function applyQuickFix(fix: QuickFix) {
    if (!activeId) return
    const saved = await api.trips.saveVersion(tripId, { parentId: activeId, stops: fix.stops, madeBy: 'quick_fix', note: fixedChangeSentence(fix.changes) })
    await afterNewVersion(saved.id, `${saved.number}번째 안으로 저장했어요: ${fixedChangeSentence(fix.changes)}`)
  }

  async function revise() {
    if (!activeId) return
    setBusy('revise')
    setMessage(null)
    try {
      const res = await api.ai.revise({ tripId, versionId: activeId })
      await afterNewVersion(res.version.id, `의견 ${res.appliedOpinionIds.length}개를 반영해서 ${res.version.number}번째 안을 만들었어요`)
    } catch (e) {
      // AI 가 안 될 때는 다시 시도하거나 직접 고치도록 안내한다 (설계 6.4)
      const fallback = isApiError(e) && e.fallback
      setMessage({ tone: 'warn', text: fallback ? 'AI가 지금 일정을 못 짰어요. 잠시 뒤에 다시 시도하거나 “직접 고치기”로 바꿔 주세요.' : errorMessage(e) })
    }
    setBusy(null)
  }

  async function confirmVersion() {
    if (!activeId) return
    setBusy('confirm')
    setMessage(null)
    try {
      await api.trips.confirm(tripId, activeId)
      router.push(`/trips/${tripId}/final`)
    } catch (e) {
      setMessage({ tone: 'warn', text: errorMessage(e) })
      setBusy(null)
    }
  }

  async function unconfirm() {
    setBusy('confirm')
    try {
      await api.trips.unconfirm(tripId)
      detail.reload()
      setMessage({ tone: 'info', text: '확정을 풀었어요. 다시 고칠 수 있어요' })
    } catch (e) {
      setMessage({ tone: 'warn', text: errorMessage(e) })
    }
    setBusy(null)
  }

  const addOpinion = async (input: OpinionInput) => {
    if (!activeId) return
    await api.opinions.add(activeId, input)
    opinions.reload()
  }
  const removeOpinion = async (id: string) => {
    await api.opinions.remove(id)
    opinions.reload()
  }

  const editing: StopEditing | null = draft
    ? {
        move: (index, delta) => setDraft(moveStop(draft, index, delta)),
        remove: key => setDraft(removeStop(draft, key)),
        update: (key, patch) => setDraft(updateStop(draft, key, patch)),
        replace: key => setPicker({ mode: 'replace', key }),
      }
    : null

  function pickPlace(place: PlaceSummary) {
    if (!draft || !picker) return
    setDraft(picker.mode === 'add' ? [...draft, stopFromPlace(place, draft, draft[draft.length - 1]?.arriveBy ?? 'car')] : replaceStopPlace(draft, picker.key, place))
    setPicker(null)
  }

  if (user === undefined || detail.loading) return <Spinner />
  if (detail.error || !detail.data) return <div className="mx-auto max-w-3xl px-5 py-8"><ErrorNotice message={errorMessage(detail.error)} onRetry={detail.reload} /></div>

  const { trip } = detail.data
  const confirmedHere = trip.confirmedVersionId === activeId
  const unapplied = opinions.data?.filter(o => !o.appliedInVersionId).length ?? 0
  const generalOpinions = opinions.data?.filter(o => o.stopKey === null) ?? []
  const canJudge = detail.data.travelers.length > 0

  return (
    <div className="mx-auto w-full max-w-[96rem] px-5 py-6">
      <PageTitle
        title={trip.title}
        sub={`${formatDate(trip.date)}${trip.confirmedVersionId ? ' · 확정된 여행' : ' · 작성 중'}`}
        actions={
          <>
            <Link href={`/groups/${trip.groupId}`} className="inline-flex min-h-12 items-center rounded-xl px-4 font-bold text-muted hover:bg-black/5">← 그룹으로</Link>
            <Link href={`/trips/${tripId}/travelers`} className="inline-flex min-h-12 items-center rounded-xl border border-brand px-4 font-bold text-brand-strong hover:bg-brand-soft">함께 가는 사람·걷기 조건</Link>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}

          {versions && versions.length > 0 && activeId ? (
            <VersionBar versions={versions} activeId={activeId} confirmedId={trip.confirmedVersionId} onSelect={chooseVersion} onCompare={() => setCompare(true)} disabled={busy !== null} />
          ) : (
            <Card>
              <p className="font-bold">아직 일정이 없어요.</p>
              <p className="text-muted">새 여행 만들기에서 일정을 짜 보세요.</p>
            </Card>
          )}

          {version.error && <ErrorNotice message={errorMessage(version.error)} onRetry={version.reload} />}
          {!canJudge && versions && versions.length > 0 && (
            <Notice tone="info">
              함께 가는 사람 정보가 아직 없어서 판정할 수 없어요. <Link href={`/trips/${tripId}/travelers`} className="font-bold underline">함께 가는 사람 정하기</Link>
            </Notice>
          )}

          {judged && stops ? (
            <>
              <JudgePanel
                result={judged.result}
                prev={parent.data && prevJudged ? prevJudged.result : null}
                travelers={detail.data.travelers}
                tripId={tripId}
                stopNames={stopNames}
                settled={judged.settled}
                incomplete={judged.incomplete}
                onRetry={judged.retry}
              />
              <ConditionTuner base={judged.result.condition} tuned={tuned} onChange={setTuned} />

              <Card className="flex flex-wrap gap-2">
                {draft ? (
                  <>
                    <Button onClick={() => setPicker({ mode: 'add' })} variant="secondary">+ 장소 더하기</Button>
                    <Button onClick={saveDraft} disabled={!dirty || busy !== null}>{busy === 'save' ? '저장하는 중…' : '저장하고 새 버전 만들기'}</Button>
                    <Button variant="ghost" onClick={() => (!dirty || window.confirm('고친 내용을 버릴까요?')) && setDraft(null)}>고치기 취소</Button>
                    {!dirty && <p className="w-full text-muted">장소를 바꾸면 숫자와 지도가 바로 바뀌어요. 저장해야 새 버전이 돼요.</p>}
                  </>
                ) : (
                  <>
                    <Button onClick={revise} disabled={busy !== null}>{busy === 'revise' ? 'AI가 다시 짜는 중…' : `의견 반영해서 다시 짜기${unapplied > 0 ? ` (${unapplied})` : ''}`}</Button>
                    <Button variant="secondary" onClick={() => setShowQuickFix(v => !v)} disabled={busy !== null}>빠른 수정안 보기</Button>
                    <Button variant="secondary" onClick={() => setDraft(version.data?.stops ?? null)} disabled={busy !== null || !version.data}>직접 고치기</Button>
                    {confirmedHere ? (
                      <Button variant="danger" onClick={unconfirm} disabled={busy !== null}>확정 풀기</Button>
                    ) : (
                      <Button onClick={confirmVersion} disabled={busy !== null || !!tuned}>이 안으로 확정</Button>
                    )}
                    {confirmedHere && <Link href={`/trips/${tripId}/final`} className="inline-flex min-h-12 items-center rounded-xl bg-ok-soft px-5 font-bold text-ok">확정 일정 보기</Link>}
                    {tuned && <p className="w-full text-sm text-muted">조건 바꿔 보기 중에는 확정할 수 없어요. “원래대로”를 눌러 주세요.</p>}
                  </>
                )}
              </Card>

              {showQuickFix && !draft && (
                <QuickFixPanel
                  input={{ travelers: detail.data.travelers, tuned, stops, places: judged.places, legs: judged.legs }}
                  onApply={applyQuickFix}
                  onClose={() => setShowQuickFix(false)}
                />
              )}

              <StopList
                stops={stops}
                result={judged.result}
                places={judged.places}
                legs={judged.legs}
                selectedId={selectedId}
                onSelect={setSelectedId}
                editing={editing}
                opinions={opinions.data ?? []}
                myUserId={user?.id ?? ''}
                onAddOpinion={addOpinion}
                onRemoveOpinion={removeOpinion}
              />

              <Card>
                <h2 className="text-lg font-extrabold">일정 전체에 대한 의견</h2>
                <p className="text-muted">장소와 상관없는 말도 남길 수 있어요.</p>
                <OpinionList opinions={generalOpinions} myUserId={user?.id ?? ''} onRemove={removeOpinion} />
                <OpinionForm stopKey={null} onSubmit={addOpinion} label="전체 의견 남기기" />
              </Card>
            </>
          ) : version.loading || (stops && canJudge) ? (
            <Spinner label="일정을 계산하고 있어요" />
          ) : null}
        </div>

        <div className="order-1 lg:sticky lg:top-24 lg:order-2">
          <TripMap data={mapData} selectedId={selectedId} onSelect={setSelectedId} className="h-80 lg:h-[calc(100vh-8rem)]" />
        </div>
      </div>

      {picker && <PlacePicker title={picker.mode === 'add' ? '일정에 더할 장소' : '바꿀 장소 고르기'} usedIds={(draft ?? []).flatMap(s => (s.placeId ? [s.placeId] : []))} onPick={pickPlace} onClose={() => setPicker(null)} />}
      {compare && versions && activeId && versions.length > 1 && (
        <VersionCompare
          tripId={tripId}
          versions={versions}
          travelers={detail.data.travelers}
          initialA={parentId ?? versions[0].id}
          initialB={activeId}
          onClose={() => setCompare(false)}
        />
      )}
    </div>
  )
}
