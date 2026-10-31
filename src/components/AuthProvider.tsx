'use client'

// 로그인한 사람을 앱 전체에 알려 주는 공급자. user 가 undefined 면 아직 확인 중, null 이면 로그인 안 함.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { api, type SignInInput, type SignUpInput } from '@/lib/api-client'
import type { User } from '@/lib/contracts'
import { loginRedirectPath } from '@/lib/format'

type AuthState = {
  user: User | null | undefined
  signIn: (input: SignInInput) => Promise<void>
  signUp: (input: SignUpInput) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    api.auth
      .getSession()
      .then(session => !cancelled && setUser(session))
      .catch(() => !cancelled && setUser(null))
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (input: SignInInput) => setUser(await api.auth.signIn(input)), [])
  const signUp = useCallback(async (input: SignUpInput) => setUser(await api.auth.signUp(input)), [])
  const signOut = useCallback(async () => {
    await api.auth.signOut()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, signIn, signUp, signOut }), [user, signIn, signUp, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthProvider 안에서만 쓸 수 있어요')
  return ctx
}

// 로그인이 필요한 화면 맨 위에서 부른다. 로그인 안 했으면 로그인 화면으로 보내고, 끝나면 이 화면으로 돌아오게 한다.
// 돌려주는 값: 확인이 끝나고 로그인한 사람(그 전에는 null)
export function useRequireUser(): User | null {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    // 쿼리(?group= 등)도 함께 돌아오게 한다. useSearchParams 는 Suspense 밖에서 쓰면 빌드가 막히는데(/groups 페이지에는 Suspense 가 없다)
    // 이 effect 는 브라우저에서만 도므로 주소창의 값을 직접 읽는다
    if (user === null) router.replace(loginRedirectPath(pathname, window.location.search))
  }, [user, router, pathname])
  return user ?? null
}

// ?next= 로 받은 돌아갈 주소가 우리 사이트 안의 경로일 때만 쓴다 (다른 사이트로 보내는 주소는 버린다)
export function safeNext(next: string | null | undefined, fallback = '/groups'): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}
