'use client'

import { useEffect, useRef, useState } from 'react'
import { CostPlanResponseSchema, type CostDraft, type CostPlanResponse, type SavedCostPlan } from '@/lib/contracts'
import { request, isApiError } from '@/lib/api-client/http'
import { Button } from '@/components/ui'

type Props = {
  tripId: string; versionId: string | null; day: number; scope: string; context: string;
  drafts: { key: string; value: CostDraft }[]; extraCount: number; mock: boolean;
  onRestore: (scope: string, plan: SavedCostPlan, force: boolean) => void
}
export function CostStorage({ tripId, versionId, day, scope, context, drafts, extraCount, mock, onRestore }: Props) {
  const [view, setView] = useState<{ scope: string; context: string; data: CostPlanResponse | null; busy: boolean; message: string }>({
    scope: '', context: '', data: null, busy: false, message: '',
  })
  const sequence = useRef(0)
  const endpoint = versionId ? `/api/trips/${encodeURIComponent(tripId)}/versions/${encodeURIComponent(versionId)}/costs` : ''
  useEffect(() => {
    let active = true
    const sequenceId = ++sequence.current
    if (!endpoint || mock) return
    request(`${endpoint}?day=${day}`, { schema: CostPlanResponseSchema }).then(data => {
      if (!active || sequenceId !== sequence.current) return
      setView({ scope, context, data, busy: false, message: '' })
      if (data.plan?.context === context) onRestore(scope, data.plan, false)
    }).catch(() => {
      if (active && sequenceId === sequence.current) setView({ scope, context, data: null, busy: false, message: '저장된 비용을 불러오지 못했어요. 다시 불러와 주세요.' })
    })
    return () => { active = false }
  }, [endpoint, day, mock, scope, context, onRestore])
  if (mock) return <p className="mt-2 text-sm text-muted">연습 화면의 금액은 저장·공유되지 않아요.</p>
  if (!versionId) return <p className="mt-2 text-sm text-info">일정을 저장한 뒤 비용을 저장할 수 있어요.</p>
  const current = view.scope === scope && view.context === context
  const data = current ? view.data : null
  const canSave = !!data?.available && data.context === context && !view.busy
  const message = current ? view.message : '저장된 비용 확인 중…'
  async function loadSaved() {
    const sequenceId = ++sequence.current
    setView(previous => ({ ...previous, scope, context, busy: true, message: '저장된 비용 확인 중…' }))
    try {
      const result = await request(`${endpoint}?day=${day}`, { schema: CostPlanResponseSchema })
      if (sequenceId !== sequence.current) return
      setView({ scope, context, data: result, busy: false, message: result.plan ? '저장된 비용을 불러왔어요.' : '아직 저장된 비용이 없어요.' })
      if (result.plan?.context === context) onRestore(scope, result.plan, true)
    } catch {
      if (sequenceId === sequence.current) setView(previous => ({ ...previous, busy: false, message: '비용을 불러오지 못했어요. 입력한 금액은 유지했어요.' }))
    }
  }
  async function save() {
    if (!canSave) return
    const sequenceId = ++sequence.current
    setView(previous => ({ ...previous, busy: true, message: '가족에게 공유할 비용 저장 중…' }))
    try {
      const result = await request(endpoint, { method: 'PUT', schema: CostPlanResponseSchema,
        body: { day, context, baseRevision: data?.plan?.revision ?? null, drafts, extraCount } })
      if (sequenceId !== sequence.current) return
      setView({ scope, context, data: result, busy: false, message: '이 버전·일차의 비용을 저장했어요. 가족이 함께 볼 수 있어요.' })
    } catch (error) {
      if (sequenceId !== sequence.current) return
      setView(previous => ({ ...previous, busy: false, message: isApiError(error) ? error.message : '비용을 저장하지 못했어요. 입력한 금액은 유지했어요.' }))
    }
  }
  return <div className="my-3 space-y-2">
    <p className="text-sm text-muted">비용 저장을 누르면 이 버전·일차에 저장돼요. 같은 가족 그룹이 조회·수정할 수 있어요.</p>
    {data?.available === false && <p className="text-sm text-info">서버 저장 기능을 준비 중이에요. 지금은 화면에서만 계산돼요.</p>}
    {data && data.context !== context && <p className="text-sm text-info">직접 고친 일정을 먼저 저장한 뒤 비용을 저장해 주세요.</p>}
    {data?.plan && data.plan.context !== context && <p className="text-sm text-info">저장 당시 일정·인원과 달라 기존 금액을 자동 적용하지 않았어요.</p>}
    {data?.plan && <p className="text-sm text-muted">마지막 저장: {data.plan.updatedByName} · {new Date(data.plan.updatedAt).toLocaleString('ko-KR')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={!canSave} onClick={() => void save()}>비용 저장·가족과 공유</Button>
      <Button variant="secondary" disabled={current && view.busy} onClick={() => void loadSaved()}>저장된 비용 다시 불러오기</Button>
    </div>
    {message && <p className="text-sm text-info" role="status">{message}</p>}
  </div>
}
