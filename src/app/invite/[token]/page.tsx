import { Suspense } from 'react'
import { InviteScreen } from '@/components/screens/InviteScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '초대 · 보폭' }

export default function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  return (
    <Suspense fallback={<Spinner />}>
      {params.then(({ token }) => (
        <InviteScreen token={token} />
      ))}
    </Suspense>
  )
}
