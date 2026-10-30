import { Suspense } from 'react'
import { NewTripScreen } from '@/components/screens/NewTripScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '새 여행 · 보폭' }

// ?group= 을 읽는 화면은 요청마다 달라지므로 Suspense 로 감싼다 (Cache Components)
export default function NewTripPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewTripScreen />
    </Suspense>
  )
}
