import { Suspense } from 'react'
import { GroupScreen } from '@/components/screens/GroupScreen'
import { Spinner } from '@/components/ui'

export const metadata = { title: '그룹 · 보폭' }

// 주소의 id 는 요청마다 달라지는 값이라 Suspense 안에서 풀어 쓴다 (Cache Components)
export default function GroupPage({ params }: PageProps<'/groups/[id]'>) {
  return (
    <Suspense fallback={<Spinner />}>
      {params.then(({ id }) => (
        <GroupScreen groupId={id} />
      ))}
    </Suspense>
  )
}
