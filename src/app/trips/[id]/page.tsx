import { Suspense } from 'react'
import { TripScreen } from '@/components/screens/TripScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '일정 · 보폭' }

export default function TripPage({ params }: PageProps<'/trips/[id]'>) {
  return (
    <Suspense fallback={<Spinner />}>
      {params.then(({ id }) => (
        <TripScreen tripId={id} />
      ))}
    </Suspense>
  )
}
