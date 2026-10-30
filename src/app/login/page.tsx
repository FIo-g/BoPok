import { Suspense } from 'react'
import { AuthScreen } from '@/components/screens/AuthScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '로그인 · 보폭' }

// ?next= 를 읽는 화면은 요청마다 달라지므로 Suspense 로 감싼다 (Cache Components)
export default function LoginPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthScreen mode="login" />
    </Suspense>
  )
}
