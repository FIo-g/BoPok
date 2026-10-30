// S1 시작 화면 연출 값. 시간은 모두 ms, 거리는 m, 각도는 도
import type { CameraView } from '../map/map-types'
// 건물이 솟는 줌 구간과 해상도 상한은 지도 설정(map-config)에 있고, 연출 쪽에서도 같은 이름으로 쓴다
export { PIXEL_RATIO_MAX, PIXEL_RATIO_MAX_COMPACT, RISE_ZOOM } from '../map/map-config'

// ───────── 글자 등장 (위에서 부드럽게 내려앉기) ─────────
export const TITLE_LINES = ['부모님 보폭에 맞춘', '하루 여행']
export const TITLE_TEXT = TITLE_LINES.join(' ')
export const GLYPH = { durationMs: 1200, staggerMs: 45, riseEm: -0.55, blurPx: 6, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
export const GLYPH_SEEN = { ...GLYPH, durationMs: 700, staggerMs: 20 } // 다시 들어온 경우(sessionStorage)
export const LINE2_AT = 0.7                  // 둘째 줄은 첫 줄이 이만큼(70%) 진행됐을 때 이어서
export const LEAD = { durationMs: 900, riseEm: -10, lineGapMs: 120, startAt: 0.7 } // 설명: 줄 단위, 제목이 70% 진행됐을 때 시작. riseEm 은 px
export const ACTIONS = { durationMs: 500, risePx: 6, staggerMs: 100 }
export const SEEN_KEY = 'bobok-landing-seen'
// 지도를 처음 띄우는 동안(스타일·셰이더·타일 처리)은 메인 스레드가 바빠서 글자가 끊긴다.
// 그래서 지도가 자리 잡고(idle) 나서 글자가 움직이기 시작한다. 지도가 너무 늦거나 실패하면 이 시간 뒤에 그냥 시작한다
export const READY_TIMEOUT_MS = 3000
// 나무(three.js 불러오기·만들기)는 무거워서 소개 연출이 끝난 뒤(또는 둘러보기를 누를 때)에 불러온다
export const EXTRAS_AFTER_INTRO_MS = 300
// 나무를 만드는 동안(수백 ms 메인 스레드를 쓴다)은 지도를 움직이지 않고, 이 시간이 지난 뒤에 평면 지도가 흐르기 시작한다
export const DRIFT_AFTER_EXTRAS_MS = 2500

// ───────── 글자 퇴장 ("지도 둘러보기") ─────────
export const EXIT = { durationMs: 500, staggerMs: 20, riseEm: -0.4, blurPx: 4 } // 왼쪽 글자부터. 설명·버튼도 함께 위로
export const MAP_FILTER_MS = 1800            // 지도 색이 돌아오는 시간(필터 해제)
export const VEIL_FADE_MS = 800              // 제목 뒤 덮개가 사라지는 시간

// ───────── 둘러보기 전환 ─────────
export const FLY_MS = 4000
export const HINT_MS = 2500                  // "끌어서 둘러보세요" 안내
export const BACK_FLY_MS = 2500              // "처음으로" 복귀 카메라 이동
export const PIN_FADE_MS = 600
// 첫 화면 지도: 색이 빠진 조용한 지도 (둘러보기로 넘어가면 필터가 풀린다)
export const QUIET_MAP_FILTER = 'grayscale(1) brightness(1.04)'

// ───────── 카메라 ─────────
export type LandingView = CameraView
// 단계 A: 시연 권역 중심에서 위에서 내려다본 평면
export const INTRO_VIEW: LandingView = { center: [127.385, 36.372], zoom: 14.6, pitch: 0, bearing: 0 }
export const DRIFT_METERS = 150              // 평면 지도가 천천히 흐르는 거리(왕복)
export const DRIFT_MS = 30000
// 단계 B: 내려앉아 도착하는 곳. 기울기는 줌별 제한(map-config 의 MAP_PITCH_LIMITS) 안으로 맞춰진다
export const EXPLORE_VIEW: LandingView = { center: [127.3845, 36.3705], zoom: 15.8, pitch: 62, bearing: -25 }
// 둘러보기 웨이포인트(권역 안). 첫 곳은 도착 지점과 같다
export const TOUR_MS = 14000
export const TOUR_RESUME_MS = 5000           // 만진 뒤 이만큼 안 만지면 자동 이동을 다시 이어간다
export const TOUR_WAYPOINTS: LandingView[] = [
  EXPLORE_VIEW,
  { center: [127.3885, 36.3735], zoom: 15.8, pitch: 60, bearing: 10 },
  { center: [127.3925, 36.3750], zoom: 15.8, pitch: 64, bearing: 45 },
  { center: [127.3870, 36.3775], zoom: 15.8, pitch: 62, bearing: 80 },
  { center: [127.3790, 36.3748], zoom: 15.8, pitch: 66, bearing: 15 },
]

// 시연 장소 핀(한밭수목원, 국립중앙과학관, 대전시립미술관). 좌표는 demo-geo.ts 의 입구·전시관 값
export const PLACE_PINS: { id: string; name: string; coord: [number, number] }[] = [
  { id: 'place-hanbat', name: '한밭수목원', coord: [127.3856, 36.3684] },
  { id: 'place-science', name: '국립중앙과학관', coord: [127.3770, 36.3774] },
  { id: 'place-art', name: '대전시립미술관', coord: [127.3872, 36.3753] },
]

// 둘러보기로 내려앉을 때 필요한 줌 16 건물 타일을 소개가 끝난 뒤 미리 받아 둔다(내려앉는 중 네트워크 기다림을 없앤다)
export const PREFETCH_ZOOM = 16
export const PREFETCH_RADIUS = 1 // 도착 지점 타일 둘레 몇 칸까지(1 = 3×3)

// 경도·위도 → 슬리피 맵 타일 번호
export function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return [x, y]
}

export function prefetchTileUrls(view: LandingView, template: string): string[] {
  const [cx, cy] = tileXY(view.center[0], view.center[1], PREFETCH_ZOOM)
  const urls: string[] = []
  for (let dx = -PREFETCH_RADIUS; dx <= PREFETCH_RADIUS; dx++) {
    for (let dy = -PREFETCH_RADIUS; dy <= PREFETCH_RADIUS; dy++) {
      urls.push(template.replace('{z}', String(PREFETCH_ZOOM)).replace('{x}', String(cx + dx)).replace('{y}', String(cy + dy)))
    }
  }
  return urls
}

// ───────── 화면 ─────────
export const HERO_MIN_HEIGHT_PX = 640
export const MOBILE_MAX_WIDTH = 768          // 이보다 좁으면 휴대폰: 협력 제스처, 나무·그림자 끔
// 제목 뒤 가운데 옅은 타원 덮개(바탕색 진하기, % 위치)
export const VEIL = { shape: 'ellipse 60% 45% at center', center: 0.7, mid: 0.35, midStop: 50, end: 80 }

// ───────── 등장 타임라인 계산 ─────────
export type GlyphTiming = typeof GLYPH
const glyphCount = (line: string) => [...line].filter(c => c !== ' ').length

// 글자별 시작 지연. 띄어쓰기는 지연 칸을 쓰지 않는다. 둘째 줄은 첫 줄이 LINE2_AT 만큼 진행됐을 때 이어서 시작한다.
export function glyphDelays(lines: string[], t: GlyphTiming): number[][] {
  let lineStart = 0
  return lines.map(line => {
    let n = 0
    const delays = [...line].map(c => (c === ' ' ? 0 : lineStart + n++ * t.staggerMs))
    const lineTotal = Math.max(glyphCount(line) - 1, 0) * t.staggerMs + t.durationMs
    lineStart += lineTotal * LINE2_AT
    return delays
  })
}

export type IntroTimeline = {
  delays: number[][]
  titleEnd: number        // 글자가 모두 내려앉은 시각
  leadDelays: number[]    // 설명 줄별 시작
  leadEnd: number
  actionsDelay: number    // 버튼 시작
}

export function introTimeline(lines: string[], t: GlyphTiming, leadLines = 2): IntroTimeline {
  const delays = glyphDelays(lines, t)
  const titleEnd = Math.max(...delays.flat()) + t.durationMs
  const leadStart = titleEnd * LEAD.startAt
  const leadDelays = Array.from({ length: leadLines }, (_, i) => leadStart + i * LEAD.lineGapMs)
  const leadEnd = leadDelays[leadDelays.length - 1] + LEAD.durationMs
  return { delays, titleEnd, leadDelays, leadEnd, actionsDelay: leadEnd }
}

// 퇴장: 글자 수(띄어쓰기 제외) 기준으로 모든 글자가 빠지는 데 걸리는 시간, 그리고 그 절반(이때 지도 필터 해제·카메라 이동 시작)
export function exitTotalMs(lines: string[]): number {
  const n = lines.reduce((s, l) => s + glyphCount(l), 0)
  return EXIT.durationMs + Math.max(n - 1, 0) * EXIT.staggerMs
}
export const exitHalfMs = (lines: string[]) => Math.round(exitTotalMs(lines) / 2)
