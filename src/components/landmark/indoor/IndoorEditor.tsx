'use client'

// 좌표 편집기(?debug=indoor, 개발 중에만): 평면을 누르면 x,y(0~1)를 보여 주고, 종류·이름을 골라 JSON 한 줄로 쌓는다.
// 지점 두 개를 차례로 누르면 길(edge)을 만들 수 있다. 쌓인 줄은 [복사]해서 src/lib/indoor/arts-center.ts 의 nodes/edges 에 붙여 넣는다.
// 찍은 지점은 화면의 경로 계산에도 바로 반영된다(저장은 되지 않는다).
import { useState } from 'react'
import { INDOOR_KIND_TEXT, type IndoorEdge, type IndoorKind } from '@/lib/indoor/types'
import { useIndoor } from './IndoorProvider'
import './indoor.css'

export type EditorClick = { level: number; x: number; y: number; seq: number }

const KINDS = Object.keys(INDOOR_KIND_TEXT) as IndoorKind[]
const r3 = (n: number) => Math.round(n * 1000) / 1000
const PICK_RADIUS = 0.035 // 이 거리(평면 높이 비율) 안을 누르면 새 지점 대신 기존 지점을 고른 것으로 본다

export function IndoorEditor({ click, ar }: { click: EditorClick | null; ar: number }) {
  const indoor = useIndoor()
  const [seen, setSeen] = useState<number>(0)
  const [pending, setPending] = useState<{ level: number; x: number; y: number } | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [kind, setKind] = useState<IndoorKind>('entrance')
  const [label, setLabel] = useState('')
  const [verified, setVerified] = useState(false)
  const [edgeKind, setEdgeKind] = useState<IndoorEdge['kind']>('walk')
  const [stairs, setStairs] = useState('')
  const [minM, setMinM] = useState('')
  const [maxM, setMaxM] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  // 평면을 새로 눌렀을 때만 반응한다: 기존 지점 근처면 길 끝점으로 고르고, 아니면 새 지점 후보로 둔다
  if (click && click.seq !== seen) {
    setSeen(click.seq)
    const near = indoor.nodes
      .filter(n => n.level === click.level)
      .map(n => ({ n, d: Math.hypot((n.x - click.x) * ar, n.y - click.y) }))
      .filter(c => c.d <= PICK_RADIUS)
      .sort((a, b) => a.d - b.d)[0]
    if (near) {
      setPending(null)
      setPicked(list => (list.length >= 2 ? [near.n.id] : list.includes(near.n.id) ? list : [...list, near.n.id]))
    } else {
      setPicked([])
      setPending({ level: click.level, x: r3(click.x), y: r3(click.y) })
    }
  }

  const push = (line: string) => setLines(list => [...list, line])

  const addNode = () => {
    if (!pending) return
    const count = indoor.nodes.filter(n => n.kind === kind && n.level === pending.level).length + 1
    const node = { id: `${kind}-${pending.level}-${count}`, kind, level: pending.level, x: pending.x, y: pending.y, verified, label: label.trim() || INDOOR_KIND_TEXT[kind] }
    indoor.addNode(node)
    push(JSON.stringify(node))
    setPending(null)
    setLabel('')
  }

  const addEdge = () => {
    if (picked.length !== 2) return
    const edge: IndoorEdge = { from: picked[0], to: picked[1], kind: edgeKind }
    const s = Number(stairs)
    if (edgeKind === 'stairs' && stairs !== '' && s > 0) edge.stairs = s
    const lo = Number(minM)
    const hi = Number(maxM)
    if (minM !== '' && maxM !== '' && lo >= 0 && hi >= lo) edge.meters = [lo, hi]
    indoor.addEdge(edge)
    push(JSON.stringify(edge))
    setPicked([])
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 클립보드를 못 쓰면 아래 텍스트 영역에서 직접 복사한다 */
    }
  }

  return (
    <div className="ind-editor" data-indoor-editor>
      <strong>좌표 편집기 (개발용)</strong>
      <p>
        {pending ? `새 지점 후보 · ${pending.level}층 x=${pending.x} y=${pending.y}` : picked.length > 0 ? `길 끝점 ${picked.length}/2: ${picked.join(' → ')}` : '평면을 누르면 좌표가 보여요. 지점 두 개를 차례로 누르면 길을 만들어요.'}
      </p>
      {pending && (
        <div className="ind-editorRow">
          <select value={kind} onChange={e => setKind(e.target.value as IndoorKind)} aria-label="지점 종류">
            {KINDS.map(k => <option key={k} value={k}>{INDOOR_KIND_TEXT[k]}</option>)}
          </select>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="이름(예: 정문 로비)" aria-label="지점 이름" />
          <label><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> 위치 확인함</label>
          <button type="button" onClick={addNode}>지점 추가</button>
        </div>
      )}
      {picked.length === 2 && (
        <div className="ind-editorRow">
          <select value={edgeKind} onChange={e => setEdgeKind(e.target.value as IndoorEdge['kind'])} aria-label="길 종류">
            <option value="walk">걷기</option>
            <option value="stairs">계단</option>
            <option value="elevator">엘리베이터</option>
          </select>
          {edgeKind === 'stairs' && <input value={stairs} onChange={e => setStairs(e.target.value)} placeholder="계단 칸 수" inputMode="numeric" aria-label="계단 칸 수" size={8} />}
          <input value={minM} onChange={e => setMinM(e.target.value)} placeholder="최소 m" inputMode="numeric" aria-label="최소 거리(m)" size={6} />
          <input value={maxM} onChange={e => setMaxM(e.target.value)} placeholder="최대 m" inputMode="numeric" aria-label="최대 거리(m)" size={6} />
          <button type="button" onClick={addEdge}>길 추가</button>
        </div>
      )}
      <textarea readOnly value={lines.join('\n')} rows={4} aria-label="쌓인 JSON" onClick={e => e.stopPropagation()} />
      <div className="ind-editorRow">
        <button type="button" onClick={copy} disabled={lines.length === 0}>{copied ? '복사됨' : '복사'}</button>
        <button type="button" onClick={() => setLines([])} disabled={lines.length === 0}>비우기</button>
      </div>
    </div>
  )
}
