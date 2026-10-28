/**
 * event_stream retention. Events are an export outbox, not an archive: they are
 * kept long enough for shippers and `logs tail` clients to catch up, then
 * purged by /api/cron/cleanup-logs.
 *
 * Per-tenant override: tenants.settings.event_stream_retention_hours
 * (default 72h, clamped to 1h…168h).
 */

export const EVENT_STREAM_RETENTION_DEFAULT_HOURS = 72
export const EVENT_STREAM_RETENTION_MAX_HOURS = 168

/** Rows deleted per purge_event_stream() call (one short transaction each). */
export const EVENT_STREAM_PURGE_BATCH = 5000
/** Upper bound on batches per tenant per cron run (≈1M rows). */
export const EVENT_STREAM_PURGE_MAX_BATCHES = 200

export function eventStreamRetentionHours(settings: unknown): number {
  const raw = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>).event_stream_retention_hours
    : undefined
  const hours = typeof raw === 'string' ? Number(raw) : raw
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
    return EVENT_STREAM_RETENTION_DEFAULT_HOURS
  }
  return Math.min(EVENT_STREAM_RETENTION_MAX_HOURS, Math.max(1, Math.floor(hours)))
}
