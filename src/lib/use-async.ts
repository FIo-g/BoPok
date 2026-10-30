'use client'

// 화면이 서버에서 값을 받아 오는 공통 틀. key 가 바뀌면 다시 불러오고(그동안 loading),
// reload() 는 이미 보이는 값을 그대로 둔 채 조용히 새로 받는다 (의견 새로고침 등).
import { useCallback, useEffect, useRef, useState } from 'react'

type Slot<T> = { key: string; data: T | undefined; error: Error | undefined }

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))

export type AsyncState<T> = {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
  // 서버를 다시 부르지 않고 화면의 값만 바꾼다 (저장 응답을 바로 반영할 때)
  mutate: (data: T) => void
}

// enabled 가 false 인 동안은 부르지 않고 loading 으로 둔다 (로그인 확인 전 등)
export function useAsync<T>(load: () => Promise<T>, key: string, enabled = true): AsyncState<T> {
  const [tick, setTick] = useState(0)
  const [slot, setSlot] = useState<Slot<T> | null>(null)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadRef
      .current()
      .then(data => !cancelled && setSlot({ key, data, error: undefined }))
      .catch((e: unknown) => !cancelled && setSlot(prev => ({ key, data: prev?.key === key ? prev.data : undefined, error: toError(e) })))
    return () => {
      cancelled = true
    }
  }, [key, tick, enabled])

  const reload = useCallback(() => setTick(t => t + 1), [])
  const mutate = useCallback((data: T) => setSlot({ key, data, error: undefined }), [key])
  const current = enabled && slot?.key === key ? slot : null
  return { data: current?.data, error: current?.error, loading: current === null, reload, mutate }
}

// 에러를 사람이 읽는 문장으로 (서버 에러는 message 가 이미 쉬운 말이다)
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : '문제가 생겼어요. 잠시 뒤에 다시 해 주세요')
