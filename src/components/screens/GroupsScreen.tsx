'use client'

// 내 그룹 목록과 새 그룹 만들기
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireUser } from '@/components/AuthProvider'
import { Badge, Button, Card, ErrorNotice, Field, PageShell, PageTitle, Spinner, TextInput } from '@/components/ui'
import { api } from '@/lib/api-client'
import { errorMessage, useAsync } from '@/lib/use-async'

export function GroupsScreen() {
  const user = useRequireUser()
  const router = useRouter()
  const groups = useAsync(() => api.groups.list(), `groups:${user?.id}`, user !== null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const group = await api.groups.create({ name })
      router.push(`/groups/${group.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  if (!user) return <Spinner label="확인하고 있어요" />
  return (
    <PageShell>
      <PageTitle title="내 그룹" sub="가족 단위로 모여서 여행 일정을 함께 짜요." />
      {groups.error && <ErrorNotice message={errorMessage(groups.error)} onRetry={groups.reload} />}
      {groups.loading ? (
        <Spinner />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.data?.map(group => (
            <li key={group.id}>
              <Link href={`/groups/${group.id}`} className="block rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-xl font-extrabold">{group.name}</h2>
                  {group.role === 'owner' && <Badge tone="brand">그룹장</Badge>}
                </div>
                <p className="mt-2 text-muted">구성원 {group.memberCount}명</p>
              </Link>
            </li>
          ))}
          {groups.data?.length === 0 && (
            <li className="sm:col-span-2">
              <Card className="text-muted">
                아직 속한 그룹이 없어요. 아래에서 새 그룹을 만들거나, 가족에게 받은 초대 링크를 눌러 들어오세요.
              </Card>
            </li>
          )}
        </ul>
      )}

      <section className="mt-10" aria-labelledby="new-group">
        <h2 id="new-group" className="mb-3 text-xl font-extrabold">
          새 그룹 만들기
        </h2>
        <Card>
          <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="그룹 이름">
                <TextInput value={name} onChange={e => setName(e.target.value)} required maxLength={40} placeholder="예) 우리 가족" />
              </Field>
            </div>
            <Button type="submit" disabled={busy || name.trim() === ''}>
              만들기
            </Button>
          </form>
          {error && <ErrorNotice message={error} />}
        </Card>
      </section>
    </PageShell>
  )
}
