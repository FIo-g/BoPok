'use client'

// 첫 화면: 3D 대전 지도 히어로 + 짧은 소개. 시작하기는 로그인 상태에 따라 내 그룹 또는 가입으로 간다.
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Hero } from '@/components/landing/Hero'
import { ButtonLink, Card } from '@/components/ui'

const POINTS = [
  { title: '장소마다 계단·쉼터·걷는 시간', body: '주차장에서 입구, 관람길까지 구간별로 계단 수와 걷는 시간을 범위로 보여 드려요. 기록이 없는 곳은 “기록 없음”이라고 솔직하게 말해요.' },
  { title: '부모님 걸음에 맞춰 판정', body: '쉬지 않고 걸을 수 있는 시간, 하루 걷기, 계단 피하기를 부모님 기준으로 계산해서 “조건 충족 / 조정 필요”를 알려 드려요.' },
  { title: '가족이 함께 고쳐요', body: '장소마다 “너무 멀어요, 계단이 걱정돼요” 같은 의견을 남기면, 의견을 반영한 새 일정이 만들어지고 두 안을 나란히 비교할 수 있어요.' },
]

export function LandingScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const start = () => router.push(user ? '/groups' : '/signup')
  return (
    <main>
      <Hero onStart={start} />
      <section className="mx-auto w-full max-w-5xl px-5 py-16" aria-labelledby="points">
        <h2 id="points" className="mb-8 text-center text-3xl font-extrabold">
          부모님과의 대전 여행, 이렇게 도와드려요
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {POINTS.map(point => (
            <li key={point.title}>
              <Card className="h-full">
                <h3 className="mb-2 text-xl font-extrabold">{point.title}</h3>
                <p className="text-muted">{point.body}</p>
              </Card>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex justify-center">
          <ButtonLink href={user ? '/groups' : '/signup'} className="min-w-64">
            지금 시작하기
          </ButtonLink>
        </div>
      </section>
      <footer className="border-t border-line px-5 py-8 text-center text-sm text-muted">
        <p>걷는 시간은 모두 추정치예요. 출발 전에 운영 여부를 꼭 확인해 주세요.</p>
        <p className="mt-1">지도 © OpenStreetMap contributors · OpenFreeMap · 건물 데이터 국토교통부 GIS건물통합정보</p>
      </footer>
    </main>
  )
}
