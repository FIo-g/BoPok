import { Suspense } from 'react'
import { AuthScreen } from '@/components/screens/AuthScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '가입하기 · 보폭' }

export default function SignupPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthScreen mode="signup" />
    </Suspense>
  )
}
