// Browser client: the Supabase realtime implementation (loaded lazily by ./index).
import { getBrowserDb } from '@/lib/providers/db/browser'
import { postgresChangesFilter, type RealtimeOp } from '@/lib/realtime/topics'
import type { RealtimeProvider } from './index'

/**
 * Supabase Realtime (postgres_changes) — the behaviour the hooks had before
 * the provider seam: one channel per subscription, filtered server-side by
 * Supabase (which applies the table's SELECT policy). The socket
 * authenticates with a short-lived access token from the server
 * (lib/supabase/client: accessToken callback, refreshed on heartbeats), so
 * RLS sees the signed-in user without the browser holding a session.
 */

let seq = 0

export const supabaseRealtimeImpl: RealtimeProvider = {
  id: 'supabase',
  onPrem: false,
  subscribe(topic, filter, onChange, onStatus) {
    const db = getBrowserDb()
    let cancelled = false
    let channel: ReturnType<typeof db.channel> | null = null
    const pgFilter = postgresChangesFilter(filter)

    const join = () => {
      if (cancelled) return
      const ch = db
        .channel(`rt-${topic}-${pgFilter ?? 'all'}-${++seq}`)
        .on(
          'postgres_changes' as never,
          { event: filter.event ?? '*', schema: 'public', table: topic, ...(pgFilter ? { filter: pgFilter } : {}) },
          (payload: { eventType: RealtimeOp; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            if (cancelled) return
            const record = payload.new && Object.keys(payload.new).length > 0 ? payload.new : undefined
            const id = record?.id ?? payload.old?.id
            onChange({ topic, op: payload.eventType, ids: id ? [String(id)] : null, ...(record ? { record } : {}) })
          },
        )
        .subscribe((status: string) => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') onStatus?.('live')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error')
          else if (status === 'CLOSED') onStatus?.('closed')
        })
      channel = ch
    }

    // Fetch the access token before joining: a channel joined without one is
    // anonymous and RLS filters out everything.
    db.realtime.setAuth()
      .catch(() => undefined)
      .finally(join)

    return () => {
      cancelled = true
      if (channel) void db.removeChannel(channel)
      channel = null
    }
  },
}
