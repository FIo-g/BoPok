import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '보폭',
  description: '부모님 걸음에 맞춘 대전 하루 여행',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
