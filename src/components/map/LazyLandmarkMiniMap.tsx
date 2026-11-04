'use client'

// 위치 미니맵은 상세 화면이 열릴 때만 불러온다(서버에는 WebGL이 없다). 지도 라이브러리는 이 폴더 안에서만 부른다 (AGENTS.md 4장).
import dynamic from 'next/dynamic'

export const LazyLandmarkMiniMap = dynamic(() => import('./LandmarkMiniMap'), { ssr: false, loading: () => null })
