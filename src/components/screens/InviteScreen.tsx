'use client'

// 초대 링크로 들어온 화면: 그룹 이름을 보여 주고 참가한다. 로그인 전이면 가입·로그인 뒤 이 화면으로 돌아온다.
// 참가할 때 가족 안에서 누구인지(엄마·아빠·딸 …)를 골라 둘 수 있다. 고르지 않아도 참가된다.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Button, ButtonLink, Card, Chip, ErrorNotice, Notice, PageShell, PageTitle, Spinner, TextInput } from '@/components/ui'
import { api, isApiError } from '@/lib/api-client'
import { errorMessage, useAsync } from '@/lib/use-async'
import { RELATION_MAX_LENGTH, RELATION_OPTIONS, relationToSend } from './invite-relation'

export function InviteScreen({ token }: { token: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const preview = useAsync(() => api.invites.preview(token), `invite:${token}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 칩을 고르면 직접 쓴 글을 비우고, 직접 쓰면 칩을 푼다 (둘 중 하나만 보낸다)
  const [chip, setChip] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const relation = relationToSend(chip ?? custom)
  const back = encodeURIComponent(`/invite/${token}`)

  async function join() {
    setBusy(true)
    setError(null)
    try {
      const { groupId } = await api.invites.accept(token, relation)
      router.push(`/groups/${groupId}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      // 그룹 화면으로 넘어가도 풀어 둔다. 이 화면은 떠나도 상태가 남아 있다가(Activity) 다시 보인다
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
          <div className="flex flex-col gap-4 text-left">
            <div role="group" aria-labelledby="relation-title" className="flex flex-col gap-3 border-t border-line pt-4">
              <h2 id="relation-title" className="text-lg font-extrabold">
                가족 안에서 어떤 분이세요? <span className="font-semibold text-muted">(선택)</span>
              </h2>
              <p className="text-muted">골라 두면 그룹 구성원 목록에 이름과 함께 보여요. 고르지 않아도 참가할 수 있어요.</p>
              <div className="flex flex-wrap gap-2">
                {RELATION_OPTIONS.map(option => (
                  <Chip
                    key={option}
                    selected={chip === option}
                    disabled={busy}
                    onClick={() => {
                      setChip(cur => (cur === option ? null : option))
                      setCustom('')
                    }}
                  >
                    {option}
                  </Chip>
                ))}
              </div>
              <TextInput
                value={custom}
                onChange={e => {
                  setCustom(e.target.value)
                  setChip(null)
                }}
                maxLength={RELATION_MAX_LENGTH}
                disabled={busy}
                placeholder="목록에 없으면 직접 쓰기 (예: 며느리)"
                aria-label="가족 관계 직접 쓰기"
              />
              <p className="font-semibold" aria-live="polite">
                {relation ? `고른 관계: ${relation}` : '관계를 고르지 않았어요 (그대로 참가할 수 있어요)'}
              </p>
            </div>
            <Button onClick={join} disabled={busy} className="w-full">
              {busy ? '들어가는 중…' : `${user.name}(으)로 참가하기`}
            </Button>
          </div>
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
