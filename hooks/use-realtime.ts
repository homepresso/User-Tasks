'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getRealtimeProvider, type RealtimeChangeHandler, type RealtimeStatusHandler } from '@/lib/providers/realtime'
import { subscriptionKey, type RealtimeFilter, type RealtimeTopic } from '@/lib/realtime/topics'
import { getUserId } from '@/lib/get-user-id'

/**
 * Subscribe to realtime changes on one topic through the configured
 * RealtimeProvider (Supabase Realtime or SSE). `filter` null means "not
 * yet" (e.g. waiting for the user id) and holds no subscription. The
 * subscription is keyed by topic + filter, so it is replaced only when those
 * change; the latest handlers are always the ones called.
 */
export function useRealtime(
  topic: RealtimeTopic,
  filter: RealtimeFilter | null,
  onChange: RealtimeChangeHandler,
  options: { enabled?: boolean; onStatus?: RealtimeStatusHandler } = {},
): void {
  const changeRef = useRef(onChange)
  const statusRef = useRef(options.onStatus)
  useEffect(() => {
    changeRef.current = onChange
    statusRef.current = options.onStatus
  })

  const enabled = options.enabled !== false && filter !== null
  const key = filter ? subscriptionKey(topic, filter) : null

  useEffect(() => {
    if (!enabled || !filter) return
    return getRealtimeProvider().subscribe(
      topic,
      filter,
      (change) => changeRef.current(change),
      (status) => statusRef.current?.(status),
    )
    // The key captures topic + filter; `filter` identity may change every render.
  }, [enabled, key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The signed-in user's id for realtime filters (null until known, or when signed out). */
export function useRealtimeUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getUserId().then((id) => { if (!cancelled) setUserId(id) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return userId
}

/** Debounced callback: bursts (workflow runs touching many rows) collapse into one call. */
export function useDebounced(fn: () => void, ms: number): () => void {
  const fnRef = useRef(fn)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      fnRef.current()
    }, ms)
  }, [ms])
}
