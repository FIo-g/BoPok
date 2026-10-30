'use client'

// 서버에는 WebGL이 없어서 지도는 브라우저에서만 불러온다. 지도가 뜨기 전에는 바탕색만 보인다.
// 다른 화면은 지도 라이브러리를 직접 부르지 않고 이 컴포넌트에 경로·핀·범위 같은 값만 넘긴다 (AGENTS.md 4장).
import dynamic from 'next/dynamic'
import { MAP_BG_COLOR } from './map-config'

export const LazyMapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div style={{ background: MAP_BG_COLOR, width: '100%', height: '100%' }} />,
})
