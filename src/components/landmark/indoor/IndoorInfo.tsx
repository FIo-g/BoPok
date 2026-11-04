'use client'

// 홀 실내 보기의 오른쪽 정보 카드 내용: 홀 이름, 층·좌석 수, 시연용 안내, "어디로 가세요?" 경로 고르기와 결과.
import { hallSeatText } from '@/lib/indoor/arts-center'
import type { RouteMode } from '@/lib/indoor/route'
import { useIndoor } from './IndoorProvider'
import './indoor.css'

const MODES: { mode: RouteMode; text: string }[] = [
  { mode: 'nostairs', text: '계단 없이' },
  { mode: 'shortest', text: '가장 짧게' },
]

export function IndoorInfo({ titleId }: { titleId: string }) {
  const indoor = useIndoor()
  const { hall, dest, mode, result, found, chip } = indoor
  const levels = [...hall.floors].sort((a, b) => a.level - b.level).map(f => f.level)

  return (
    <div className="ind-info">
      <h2 id={titleId} className="ind-hallName">{hall.name}</h2>
      <p className="ind-seatText">{hallSeatText(hall)}</p>
      <p className="ind-notice">시연용 개략도 · 실제 배치와 다를 수 있어요</p>

      <section className="ind-routeBox" aria-label="실내 경로">
        <h3 className="ind-routeTitle">어디로 가세요?</h3>
        <div className="ind-chipRow" role="group" aria-label="도착할 객석 층">
          {levels.map(l => (
            <button key={l} type="button" className="ind-pick" aria-pressed={dest === l} onClick={() => indoor.selectDest(l)}>{l}층 객석</button>
          ))}
        </div>
        <div className="ind-chipRow" role="group" aria-label="길 찾기 방식">
          {MODES.map(m => (
            <button key={m.mode} type="button" className="ind-pick" data-small aria-pressed={mode === m.mode} onClick={() => indoor.setMode(m.mode)}>{m.text}</button>
          ))}
        </div>

        {dest === null && <p className="ind-hint">도착할 객석 층을 고르면 입구에서 가는 길을 그려 드려요.</p>}
        {dest !== null && (result?.status === 'no-data' || result?.status === 'blocked') && (
          <p className="ind-hint" role="status">실내 경로 정보 준비 중</p>
        )}
        {dest !== null && chip && found && (
          <div role="status">
            <p className="ind-summaryChip" data-tone={chip.tone}>{chip.text}</p>
            {chip.warnings.length > 0 && (
              <ul className="ind-warnings">
                {chip.warnings.map(w => <li key={w}>{w}</li>)}
              </ul>
            )}
            <ol className="ind-steps" aria-label="가는 순서">
              {found.steps.map(step => <li key={step}>{step.replace(/^\d+\.\s*/, '')}</li>)}
            </ol>
          </div>
        )}
      </section>
    </div>
  )
}
