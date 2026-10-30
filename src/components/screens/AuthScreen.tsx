'use client'

// 로그인·가입 화면. 가입하거나 로그인하면 ?next= 로 받은 곳(초대 링크 등)으로 돌아간다.
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeNext, useAuth } from '@/components/AuthProvider'
import { Button, Card, ErrorNotice, Field, PageShell, PageTitle, TextInput } from '@/components/ui'
import { USE_MOCKS } from '@/lib/api-client'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/mocks'
import { errorMessage } from '@/lib/use-async'

export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter()
  const next = safeNext(useSearchParams().get('next'))
  const { signIn, signUp } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signup = mode === 'signup'

  async function submit(event: FormEvent, override?: { email: string; password: string }) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const creds = override ?? { email: email.trim(), password }
      if (signup && !override) await signUp({ name: name.trim(), ...creds })
      else await signIn(creds)
      router.replace(next)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const otherHref = `${signup ? '/login' : '/signup'}?next=${encodeURIComponent(next)}`
  return (
    <PageShell className="max-w-md">
      <PageTitle title={signup ? '가입하기' : '로그인'} sub={signup ? '가족마다 각자 계정을 만들어요. 부모님도 직접 들어와 의견을 남길 수 있어요.' : '가족과 함께 짠 여행 일정을 볼 수 있어요.'} />
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {signup && (
            <Field label="이름">
              <TextInput value={name} onChange={e => setName(e.target.value)} required maxLength={20} autoComplete="name" placeholder="예) 오하연" />
            </Field>
          )}
          <Field label="이메일">
            <TextInput type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="example@email.com" />
          </Field>
          <Field label="비밀번호" hint={signup ? '8자 이상으로 만들어 주세요' : undefined}>
            <TextInput
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={signup ? 8 : undefined}
              autoComplete={signup ? 'new-password' : 'current-password'}
            />
          </Field>
          {error && <ErrorNotice message={error} />}
          <Button type="submit" disabled={busy}>
            {busy ? '잠시만요…' : signup ? '가입하고 시작하기' : '로그인'}
          </Button>
        </form>
        {USE_MOCKS && !signup && (
          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={busy}
            onClick={event => submit(event, { email: DEMO_EMAIL, password: DEMO_PASSWORD })}
          >
            연습용 계정으로 바로 들어가기
          </Button>
        )}
      </Card>
      <p className="mt-5 text-center text-muted">
        {signup ? '이미 계정이 있나요? ' : '처음이세요? '}
        <Link href={otherHref} className="font-bold text-brand underline">
          {signup ? '로그인' : '가입하기'}
        </Link>
      </p>
    </PageShell>
  )
}
