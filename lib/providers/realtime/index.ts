import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { getPublicConfig } from '@/lib/config/public'
import type { RealtimeChange, RealtimeFilter, RealtimeStatus, RealtimeTopic } from '@/lib/realtime/topics'
import { pickProvider } from '../registry'
import { sseRealtimeProvider } from './sse'

/**
 * RealtimeProvider (browser): change notifications for one topic (a published
 * table), optionally filtered by a column value and operation. Hooks use it
 * through hooks/use-realtime.ts and react by invalidating React Query caches.
 *
 *  - supabase (default): Supabase Realtime postgres_changes, as before. The
 *    implementation (and supabase-js) loads on first subscribe only.
 *  - sse: one EventSource per tab to /api/internal/realtime, fed by Postgres
 *    LISTEN/NOTIFY on the server (lib/realtime). No supabase-js.
 *
 * The browser learns which one to use from the runtime public config
 * (REALTIME_PROVIDER / instance setting providers.realtime).
 */

export type RealtimeChangeHandler = (change: RealtimeChange) => void
export type RealtimeStatusHandler = (status: RealtimeStatus) => void

export interface RealtimeProvider {
  readonly id: ProviderId<'realtime'>
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  /** Subscribe; returns an unsubscribe function. */
  subscribe(topic: RealtimeTopic, filter: RealtimeFilter, onChange: RealtimeChangeHandler, onStatus?: RealtimeStatusHandler): () => void
}

/** Loads ./supabase (and with it supabase-js) only when a subscription is made. */
export const supabaseRealtimeProvider: RealtimeProvider = {
  id: 'supabase',
  onPrem: false,
  subscribe(topic, filter, onChange, onStatus) {
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    onStatus?.('connecting')
    import('./supabase')
      .then(({ supabaseRealtimeImpl }) => {
        if (!cancelled) unsubscribe = supabaseRealtimeImpl.subscribe(topic, filter, onChange, onStatus)
      })
      .catch(() => { if (!cancelled) onStatus?.('error') })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  },
}

export function resolveRealtimeProvider(id: ProviderId<'realtime'> = DEFAULT_PROVIDERS.realtime): RealtimeProvider {
  return pickProvider('realtime', id, {
    supabase: () => supabaseRealtimeProvider,
    sse: () => sseRealtimeProvider,
  })
}

/** Browser: the provider the instance is configured with. */
export function getRealtimeProvider(): RealtimeProvider {
  return resolveRealtimeProvider(getPublicConfig().realtimeProvider ?? DEFAULT_PROVIDERS.realtime)
}
