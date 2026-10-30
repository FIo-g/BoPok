'use client'

// 모든 화면 위에 있는 줄: 로고, 내 그룹, 글자 크기(가 / 가+), 로그인·로그아웃
import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getFontScale, getServerFontScale, setFontScale, subscribeFontScale } from '@/lib/font-size'
import { USE_MOCKS } from '@/lib/api-client'
import { useAuth } from './AuthProvider'
import { Button, cx } from './ui'

export function FontSizeToggle() {
  const scale = useSyncExternalStore(subscribeFontScale, getFontScale, getServerFontScale)
  const option = (value: 'normal' | 'large', text: string, label: string) => (
    <button
      type="button"
      aria-pressed={scale === value}
      aria-label={label}
      onClick={() => setFontScale(value)}
      className={cx('min-h-10 min-w-11 rounded-lg px-3 font-bold', scale === value ? 'bg-brand text-white' : 'text-muted hover:bg-black/5')}
    >
      {text}
    </button>
  )
  return (
    <div role="group" aria-label="글자 크기" className="flex rounded-xl border border-line bg-white p-0.5">
      {option('normal', '가', '글자 보통')}
      {option('large', '가+', '글자 크게')}
    </div>
  )
}

export function SiteHeader() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  return (
    <>
      {USE_MOCKS && (
        <div className="bg-brand-soft px-4 py-1 text-center text-sm font-semibold text-brand-strong">
          연습용 가짜 데이터예요 (서버에 저장되지 않아요)
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2 sm:px-5">
          <Link href="/" className="text-2xl font-extrabold tracking-tight text-ink">
            보폭
          </Link>
          <nav aria-label="주요 메뉴" className="flex flex-wrap items-center gap-2">
            {user && (
              <Link href="/groups" className="inline-flex min-h-10 items-center rounded-lg px-3 font-bold text-muted hover:bg-black/5">
                내 그룹
              </Link>
            )}
            <FontSizeToggle />
            {user ? (
              <Button
                variant="ghost"
                className="min-h-10 px-3"
                aria-label={`${user.name} 로그아웃`}
                onClick={async () => {
                  await signOut()
                  router.push('/')
                }}
              >
                <span className="hidden sm:inline">{user.name} · </span>
                로그아웃
              </Button>
            ) : user === null ? (
              <Link href="/login" className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 font-bold text-white hover:bg-brand-strong">
                로그인
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
    </>
  )
}
