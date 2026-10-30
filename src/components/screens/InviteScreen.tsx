'use client'

// 초대 링크로 들어온 화면: 그룹 이름을 보여 주고 참가한다. 로그인 전이면 가입·로그인 뒤 이 화면으로 돌아온다.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Button, ButtonLink, Card, ErrorNotice, Notice, PageShell, PageTitle, Spinner } from '@/components/ui'
import { api, isApiError } from '@/lib/api-client'
import { errorMessage, useAsync } from '@/lib/use-async'

export function InviteScreen({ token }: { token: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const preview = useAsync(() => api.invites.preview(token), `invite:${token}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const back = encodeURIComponent(`/invite/${token}`)

  async function join() {
    setBusy(true)
    setError(null)
    try {
      const { groupId } = await api.invites.accept(token)
      router.push(`/groups/${groupId}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  if (preview.loading) return <Spinner />
  if (preview.error) {
    const expired = isApiError(preview.error) && preview.error.code === 'expired'
    return (
      <PageShell className="max-w-md">
        <PageTitle title={expired ? '초대 링크가 만료됐어요' : '초대 링크를 찾을 수 없어요'} />
        <Notice tone="warn">{expired ? '그룹장에게 새 초대 링크를 보내 달라고 말해 주세요.' : '주소가 맞는지 확인하거나, 그룹장에게 다시 받아 주세요.'}</Notice>
      </PageShell>
    )
  }
  return (
    <PageShell className="max-w-md">
      <PageTitle title="초대를 받았어요" />
      <Card className="text-center">
        <p className="text-muted">함께 여행을 짤 그룹</p>
        <p className="my-3 text-3xl font-extrabold">{preview.data?.groupName}</p>
        {user ? (
          <Button onClick={join} disabled={busy} className="w-full">
            {busy ? '들어가는 중…' : `${user.name}(으)로 참가하기`}
          </Button>
        ) : user === null ? (
          <div className="flex flex-col gap-2">
            <p className="mb-2 text-muted">참가하려면 먼저 로그인해 주세요. 끝나면 이 화면으로 돌아와요.</p>
            <ButtonLink href={`/login?next=${back}`}>로그인하고 참가하기</ButtonLink>
            <ButtonLink href={`/signup?next=${back}`} variant="secondary">
              처음이에요 · 가입하고 참가하기
            </ButtonLink>
          </div>
        ) : (
          <Spinner label="확인하고 있어요" />
        )}
        {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
      </Card>
    </PageShell>
  )
}
