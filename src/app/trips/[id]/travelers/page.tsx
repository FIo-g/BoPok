import { Suspense } from 'react'
import { TravelersScreen } from '@/components/screens/TravelersScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '함께 가는 사람 · 보폭' }

export default function TravelersPage({ params }: PageProps<'/trips/[id]/travelers'>) {
  return (
    <Suspense fallback={<Spinner />}>
      {params.then(({ id }) => (
        <TravelersScreen tripId={id} />
      ))}
    </Suspense>
  )
}
