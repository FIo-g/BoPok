'use client'

// 로그인한 사람을 앱 전체에 알려 주는 공급자. user 가 undefined 면 아직 확인 중, null 이면 로그인 안 함.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { api, type SignInInput, type SignUpInput } from '@/lib/api-client'
import type { User } from '@/lib/contracts'
import { requireUserRedirect } from '@/lib/format'

type AuthState = {
  user: User | null | undefined
  // 로그아웃 버튼으로 나가서 user 가 null 이 됐으면 true (다시 로그인·가입하면 false).
  // 이때 로그인이 필요한 화면은 next= 없이 첫 화면으로 보낸다 — 아니면 다음 사람이 앞 사람의 화면으로 돌아간다
  signedOut: boolean
  signIn: (input: SignInInput) => Promise<void>
  signUp: (input: SignUpInput) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

type Session = { user: User | null | undefined; signedOut: boolean }

export function AuthProvider({ children }: { children: ReactNode }) {
  // user 와 signedOut 은 한 번에 바뀌어야 한다. 로그아웃 순간 user 만 null 인 화면이 그려지면 next= 로 보내 버린다
  const [{ user, signedOut }, setSession] = useState<Session>({ user: undefined, signedOut: false })

  useEffect(() => {
    let cancelled = false
    api.auth
      .getSession()
      .then(session => !cancelled && setSession(cur => ({ ...cur, user: session })))
      .catch(() => !cancelled && setSession(cur => ({ ...cur, user: null })))
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (input: SignInInput) => setSession({ user: await api.auth.signIn(input), signedOut: false }), [])
  const signUp = useCallback(async (input: SignUpInput) => setSession({ user: await api.auth.signUp(input), signedOut: false }), [])
  const signOut = useCallback(async () => {
    await api.auth.signOut()
    setSession({ user: null, signedOut: true })
  }, [])

  const value = useMemo(() => ({ user, signedOut, signIn, signUp, signOut }), [user, signedOut, signIn, signUp, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider 안에서만 쓸 수 있어요')
  return ctx
}

// 로그인이 필요한 화면 맨 위에서 부른다. 로그인 안 했으면 로그인 화면으로 보내고, 끝나면 이 화면으로 돌아오게 한다.
// 로그아웃 버튼으로 나간 경우에는 첫 화면으로 보낸다 (머리글도 첫 화면으로 보내므로 둘이 같은 곳을 가리킨다).
// 돌려주는 값: 확인이 끝나고 로그인한 사람(그 전에는 null)
export function useRequireUser(): User | null {
  const { user, signedOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    // 쿼리(?group= 등)도 함께 돌아오게 한다. useSearchParams 는 Suspense 밖에서 쓰면 빌드가 막히는데(/groups 페이지에는 Suspense 가 없다)
    // 이 effect 는 브라우저에서만 도므로 주소창의 값을 직접 읽는다
    const to = requireUserRedirect(user, signedOut, pathname, window.location.search)
    if (to) router.replace(to)
  }, [user, signedOut, router, pathname])
  return user ?? null
}

// ?next= 로 받은 돌아갈 주소가 우리 사이트 안의 경로일 때만 쓴다 (다른 사이트로 보내는 주소는 버린다)
export function safeNext(next: string | null | undefined, fallback = '/groups'): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}
