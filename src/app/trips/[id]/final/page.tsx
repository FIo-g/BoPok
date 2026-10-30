import { Suspense } from 'react'
import { FinalScreen } from '@/components/screens/FinalScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '확정 일정 · 보폭' }

export default function FinalPage({ params }: PageProps<'/trips/[id]/final'>) {
  return (
    <Suspense fallback={<Spinner />}>
      {params.then(({ id }) => (
        <FinalScreen tripId={id} />
      ))}
    </Suspense>
  )
}
