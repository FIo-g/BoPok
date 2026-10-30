import { describe, expect, it } from 'vitest'
import {
  ACTIONS, EXIT, EXPLORE_VIEW, GLYPH, GLYPH_SEEN, INTRO_VIEW, LEAD, LINE2_AT, PLACE_PINS, QUIET_MAP_FILTER,
  TITLE_LINES, TOUR_WAYPOINTS, VEIL, exitHalfMs, exitTotalMs, glyphDelays, introTimeline, prefetchTileUrls, tileXY,
} from './landing-intro'
import fs from 'node:fs'
import path from 'node:path'
import { BUILDINGS_TILES, MAP_MAX_BOUNDS, TREE_BBOX } from '../map/map-config'
import { maxPitchForZoom } from '../map/map-limits'

const lineGlyphDelays = (delays: number[], line: string) => delays.filter((_, i) => line[i] !== ' ')

describe('글자 등장', () => {
  it('글자마다 45ms 씩 늦게 시작하고 띄어쓰기는 칸을 쓰지 않는다', () => {
    const [d1] = glyphDelays(TITLE_LINES, GLYPH)
    expect(lineGlyphDelays(d1, TITLE_LINES[0])).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
  })

  it('둘째 줄은 첫 줄이 70% 진행됐을 때 이어서 시작한다', () => {
    const [d1, d2] = glyphDelays(TITLE_LINES, GLYPH)
    const line1Total = (8 - 1) * GLYPH.staggerMs + GLYPH.durationMs
    expect(Math.min(...lineGlyphDelays(d2, TITLE_LINES[1]))).toBeCloseTo(line1Total * LINE2_AT)
    expect(Math.max(...d1)).toBeLessThan(Math.min(...lineGlyphDelays(d2, TITLE_LINES[1])) + line1Total)
  })

  it('다시 들어온 경우는 간격 20ms·길이 700ms 로 훨씬 짧다', () => {
    expect(GLYPH_SEEN.staggerMs).toBe(20)
    expect(GLYPH_SEEN.durationMs).toBe(700)
    expect(introTimeline(TITLE_LINES, GLYPH_SEEN).titleEnd).toBeLessThan(introTimeline(TITLE_LINES, GLYPH).titleEnd)
  })

  it('설명은 제목이 70% 진행됐을 때 줄 단위(120ms 간격)로, 버튼은 설명이 끝난 뒤', () => {
    const t = introTimeline(TITLE_LINES, GLYPH)
    expect(t.leadDelays[0]).toBeCloseTo(t.titleEnd * LEAD.startAt)
    expect(t.leadDelays[1] - t.leadDelays[0]).toBe(LEAD.lineGapMs)
    expect(t.actionsDelay).toBe(t.leadDelays[1] + LEAD.durationMs)
    expect(ACTIONS.durationMs).toBe(500)
  })
})

describe('글자 퇴장', () => {
  it('글자 12개가 20ms 간격으로 빠지면 720ms, 절반인 360ms 에 지도 이동 시작', () => {
    expect(exitTotalMs(TITLE_LINES)).toBe(EXIT.durationMs + 11 * EXIT.staggerMs)
    expect(exitHalfMs(TITLE_LINES)).toBe(360)
  })
})

describe('지도 연출 값', () => {
  it('첫 화면 지도는 색이 빠진 필터, 덮개는 옅은 타원', () => {
    expect(QUIET_MAP_FILTER).toContain('grayscale')
    expect(VEIL.shape).toBe('ellipse 60% 45% at center')
    expect(VEIL.center).toBe(0.7)
    expect(VEIL.mid).toBe(0.35)
  })

  it('웨이포인트와 핀이 시연 권역 안, 이동 범위 안에 있다', () => {
    const [w, s, e, n] = TREE_BBOX
    for (const v of [INTRO_VIEW, ...TOUR_WAYPOINTS]) {
      expect(v.center[0]).toBeGreaterThanOrEqual(w)
      expect(v.center[0]).toBeLessThanOrEqual(e)
      expect(v.center[1]).toBeGreaterThanOrEqual(s)
      expect(v.center[1]).toBeLessThanOrEqual(n)
    }
    for (const p of PLACE_PINS) {
      expect(p.coord[0]).toBeGreaterThan(MAP_MAX_BOUNDS[0])
      expect(p.coord[0]).toBeLessThan(MAP_MAX_BOUNDS[2])
    }
  })

  it('웨이포인트는 4~5곳이고 첫 곳은 도착 지점', () => {
    expect(TOUR_WAYPOINTS.length).toBeGreaterThanOrEqual(4)
    expect(TOUR_WAYPOINTS.length).toBeLessThanOrEqual(5)
    expect(TOUR_WAYPOINTS[0]).toEqual(EXPLORE_VIEW)
  })

  it('둘러보기 기울기는 60~66 이고 줌별 제한이 60 이면 60 으로 맞춰진다', () => {
    for (const v of TOUR_WAYPOINTS) {
      expect(v.pitch).toBeGreaterThanOrEqual(60)
      expect(v.pitch).toBeLessThanOrEqual(66)
      expect(Math.min(v.pitch, maxPitchForZoom(v.zoom))).toBe(60)
    }
  })

  it('첫 화면은 평면(pitch 0)', () => {
    expect(INTRO_VIEW.pitch).toBe(0)
    expect(INTRO_VIEW.zoom).toBe(14.6)
  })
})

describe('타일 미리 받기', () => {
  it('도착 지점 줌 16 타일 번호가 실제 타일 파일 이름과 맞다', () => {
    const [x, y] = tileXY(EXPLORE_VIEW.center[0], EXPLORE_VIEW.center[1], 16)
    expect(fs.existsSync(path.join(__dirname, `../../../public/tiles/buildings/16/${x}/${y}.pbf`))).toBe(true)
  })

  it('3×3 = 9개 주소를 만든다', () => {
    const urls = prefetchTileUrls(EXPLORE_VIEW, BUILDINGS_TILES)
    expect(urls).toHaveLength(9)
    expect(new Set(urls).size).toBe(9)
    expect(urls[0]).toMatch(/^\/tiles\/buildings\/16\/\d+\/\d+\.pbf$/)
  })
})
