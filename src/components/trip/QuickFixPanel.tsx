'use client'

// 빠른 수정안 A·B·C 카드 (설계 7.4). 엔진(quickFixes)이 돌려준 안을 그대로 보여 주고, 고르면 그 stops 로 새 버전을 저장한다.
import { useMemo, useState } from 'react'
import type { JudgeInput, QuickFix } from '@/lib/contracts'
import { fixedChangeSentence, formatRange, quickFixes } from '@/lib/engine'
import { errorMessage } from '@/lib/use-async'
import { Button, Card, ErrorNotice, Notice, VerdictBadge } from '@/components/ui'

const LEVEL_TEXT = {
  A: { title: 'A안 · 동선 조정', body: '계단 구간은 우회로로, 꼭 보지 않아도 되는 구간은 빼요' },
  B: { title: 'B안 · 쉬는 곳 추가', body: '쉼터에서 쉬는 시간을 넣어요' },
  C: { title: 'C안 · 이동수단 변경', body: '장소 사이를 택시로 바꿔요' },
} as const

export function QuickFixPanel({ input, onApply, onClose }: { input: JudgeInput; onApply: (fix: QuickFix) => Promise<void>; onClose: () => void }) {
  const fixes = useMemo(() => quickFixes(input), [input])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function apply(fix: QuickFix) {
    setBusy(fix.level)
    setError(null)
    try {
      await onApply(fix)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">빠른 수정안</h2>
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
      {fixes.length === 0 ? (
        <Notice tone="ok">고칠 곳이 없어요. 이 일정은 지금 조건에 맞아요.</Notice>
      ) : (
        <ul className="grid gap-3">
          {fixes.map(fix => (
            <li key={fix.level} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-extrabold">{LEVEL_TEXT[fix.level].title}</h3>
                <VerdictBadge verdict={fix.result.verdict} />
              </div>
              <p className="text-muted">{LEVEL_TEXT[fix.level].body}</p>
              <p className="mt-2 font-bold">{fixedChangeSentence(fix.changes)}</p>
              <p className="mt-1 text-muted">
                하루 걷기 {formatRange(fix.result.day)} · 가장 긴 연속 {formatRange(fix.result.longest)} · 추정치
              </p>
              <p className={fix.enough ? 'mt-1 font-bold text-ok' : 'mt-1 font-bold text-warn'}>
                {fix.enough ? '✓ 이렇게 하면 조건에 맞아요' : '! 그래도 조건을 넘는 곳이 남아요'}
              </p>
              <Button className="mt-3" onClick={() => apply(fix)} disabled={busy !== null}>
                {busy === fix.level ? '저장하는 중…' : '이 안으로 새 버전 만들기'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorNotice message={error} />}
    </Card>
  )
}
