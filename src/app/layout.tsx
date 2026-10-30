import type { Metadata } from 'next'
import { AuthProvider } from '@/components/AuthProvider'
import { SiteHeader } from '@/components/SiteHeader'
import { FONT_INIT_SCRIPT } from '@/lib/font-size'
import './globals.css'

export const metadata: Metadata = {
  title: '보폭',
  description: '부모님 걸음에 맞춘 대전 하루 여행',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // 글자 크기(data-font)를 첫 화면 전에 붙이는 스크립트가 html 속성을 바꾸므로 경고를 끈다
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FONT_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <SiteHeader />
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
