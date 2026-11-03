'use client'
import { useState } from 'react'
import { api } from '@/lib/api-client'
import type { PlaceDetail } from '@/lib/contracts'
export function ResearchNotice({ research }: { research?: PlaceDetail['research'] }) {
  return research ? <p className="mt-2 text-sm text-info" role="note">{research.notice} 전체 연속 휠체어 접근: 미확인.</p> : null
}
export function ResearchInfo({ placeId }: { placeId: string }) {
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const [message, setMessage] = useState('')
  return <div>
    <button type="button" className="min-h-12 text-sm text-brand-strong underline" onClick={async () => {
      try { const result = await api.places.get(placeId); setDetail(result); setMessage(result.research ? '' : '등록된 추가 조사 안내가 없어요. 계단 기록 없음은 계단이 없다는 뜻이 아니에요.') }
      catch { setMessage('조사 안내를 불러오지 못했어요.') }
    }}>조사 범위·미확인 정보 보기</button>
    <ResearchNotice research={detail?.research} />
    {message && <p className="text-sm text-info">{message}</p>}
  </div>
}
