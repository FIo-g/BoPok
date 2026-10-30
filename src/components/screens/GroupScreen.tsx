'use client'

// 그룹 화면: 여행 목록(작성 중 / 확정), 구성원, 초대 링크 만들기
import { useState } from 'react'
import Link from 'next/link'
import { useRequireUser } from '@/components/AuthProvider'
import { Badge, Button, ButtonLink, Card, ErrorNotice, Notice, PageShell, PageTitle, Spinner, VerdictBadge } from '@/components/ui'
import { api } from '@/lib/api-client'
import type { GroupDetail, Invite, TripListItem } from '@/lib/contracts'
import { formatRange } from '@/lib/engine'
import { copyText, formatDate, madeByText, versionLabel } from '@/lib/format'
import { errorMessage, useAsync } from '@/lib/use-async'

function TripCard({ item }: { item: TripListItem }) {
  const { trip, latestVersion, confirmedVersion } = item
  const shown = confirmedVersion ?? latestVersion
  const confirmed = confirmedVersion !== null
  return (
    <li>
      <Link
        href={confirmed ? `/trips/${trip.id}/final` : `/trips/${trip.id}`}
        className="block rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-xl font-extrabold">{trip.title}</h3>
          {confirmed ? <Badge tone="ok">✓ 확정</Badge> : <Badge tone="neutral">작성 중</Badge>}
        </div>
        <p className="mt-1 text-muted">{formatDate(trip.date)}</p>
        {shown?.summary ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={shown.summary.verdict} />
            <span className="text-muted">
              {versionLabel(shown)} · 하루 걷기 {formatRange(shown.summary.day)} · 추정치
            </span>
          </div>
        ) : (
          <p className="mt-3 text-muted">{shown ? '판정 요약을 준비하고 있어요' : '아직 일정이 없어요'}</p>
        )}
        {confirmed && trip.confirmedByName && <p className="mt-2 text-sm text-muted">{trip.confirmedByName}님이 확정했어요 · {madeByText(confirmedVersion)}</p>}
      </Link>
    </li>
  )
}

function InviteBox({ groupId }: { groupId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const url = invite ? `${window.location.origin}/invite/${invite.token}` : ''

  async function make() {
    setBusy(true)
    setError(null)
    try {
      setInvite(await api.groups.createInvite(groupId))
      setCopied(null)
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  return (
    <div>
      <Button variant="secondary" onClick={make} disabled={busy}>
        초대 링크 만들기
      </Button>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
      {invite && (
        <div className="mt-3 rounded-xl bg-brand-soft p-4">
          <p className="break-all font-bold text-brand-strong">{url}</p>
          <p className="mt-1 text-sm text-muted">7일 동안 여러 명이 쓸 수 있어요 (만료: {formatDate(invite.expiresAt.slice(0, 10))})</p>
          <Button className="mt-3" onClick={async () => setCopied((await copyText(url)) ? 'yes' : 'no')}>
            링크 복사하기
          </Button>
          {copied === 'yes' && <p className="mt-2 font-bold text-ok">✓ 복사했어요. 가족에게 보내 주세요</p>}
          {copied === 'no' && <p className="mt-2 font-bold text-warn">복사하지 못했어요. 위 주소를 길게 눌러 직접 복사해 주세요</p>}
        </div>
      )}
    </div>
  )
}

function Members({ group, isOwner, myId, onChanged }: { group: GroupDetail; isOwner: boolean; myId: string; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  async function remove(userId: string) {
    setError(null)
    try {
      await api.groups.removeMember(group.id, userId)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <>
      <ul className="divide-y divide-line">
        {group.members.map(member => (
          <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <span className="font-bold">{member.name}</span>
              {member.relation && <span className="ml-2 text-muted">{member.relation}</span>}
              {member.userId === myId && <span className="ml-2 text-muted">(나)</span>}
            </div>
            <div className="flex items-center gap-2">
              {member.role === 'owner' && <Badge tone="brand">그룹장</Badge>}
              {isOwner && member.role !== 'owner' && (
                <Button variant="danger" className="min-h-10 px-3" onClick={() => remove(member.userId)} aria-label={`${member.name} 내보내기`}>
                  내보내기
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <ErrorNotice message={error} />}
    </>
  )
}

export function GroupScreen({ groupId }: { groupId: string }) {
  const user = useRequireUser()
  const key = `group:${groupId}:${user?.id}`
  const group = useAsync(() => api.groups.get(groupId), key, user !== null)
  const trips = useAsync(() => api.groups.listTrips(groupId), key, user !== null)

  if (!user) return <Spinner label="확인하고 있어요" />
  if (group.error) {
    return (
      <PageShell>
        <ErrorNotice message={errorMessage(group.error)} onRetry={group.reload} />
      </PageShell>
    )
  }
  if (group.loading || !group.data) return <Spinner />

  const isOwner = group.data.ownerId === user.id
  const draft = trips.data?.filter(t => !t.confirmedVersion) ?? []
  const confirmed = trips.data?.filter(t => t.confirmedVersion) ?? []
  return (
    <PageShell>
      <PageTitle
        title={group.data.name}
        sub={`구성원 ${group.data.members.length}명`}
        actions={<ButtonLink href={`/trips/new?group=${encodeURIComponent(groupId)}`}>+ 새 여행 만들기</ButtonLink>}
      />

      <section aria-labelledby="draft" className="mb-8">
        <h2 id="draft" className="mb-3 text-xl font-extrabold">
          작성 중인 여행
        </h2>
        {trips.error && <ErrorNotice message={errorMessage(trips.error)} onRetry={trips.reload} />}
        {trips.loading ? (
          <Spinner />
        ) : draft.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">{draft.map(item => <TripCard key={item.trip.id} item={item} />)}</ul>
        ) : (
          <Notice>작성 중인 여행이 없어요. 위의 “새 여행 만들기”로 시작해 보세요.</Notice>
        )}
      </section>

      {confirmed.length > 0 && (
        <section aria-labelledby="confirmed" className="mb-8">
          <h2 id="confirmed" className="mb-3 text-xl font-extrabold">
            확정된 여행
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">{confirmed.map(item => <TripCard key={item.trip.id} item={item} />)}</ul>
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section aria-labelledby="members">
          <h2 id="members" className="mb-3 text-xl font-extrabold">
            구성원
          </h2>
          <Card>
            <Members group={group.data} isOwner={isOwner} myId={user.id} onChanged={group.reload} />
          </Card>
        </section>
        {isOwner && (
          <section aria-labelledby="invite">
            <h2 id="invite" className="mb-3 text-xl font-extrabold">
              가족 초대하기
            </h2>
            <Card>
              <p className="mb-3 text-muted">링크를 받은 가족은 가입(또는 로그인)한 뒤 이 그룹에 들어올 수 있어요.</p>
              <InviteBox groupId={groupId} />
            </Card>
          </section>
        )}
      </div>
    </PageShell>
  )
}
