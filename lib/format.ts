/** Display formatting shared by report and run views (pure, client-safe). */

/** Compact duration: `850ms`, `12.4s`, `3.2m`, `1.5h`; `—` for zero, negative or missing. */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}
