/**
 * Durations for people (docs/design/foundations.md → Formatting):
 * `12 ms`, `4.2 s`, `3 m 10 s`, `12.7 h`, `3 d`. A space before every unit,
 * so the value lines up with `num` (tabular figures) in a column.
 *
 * lib/format.ts keeps the older compact `formatDuration` (`12.4s`) for the
 * report views that have not moved yet.
 */

/** Human duration from milliseconds; `—` for missing or negative values. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${trim(s < 10 ? s.toFixed(1) : s.toFixed(0))} s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const rest = Math.round(s - m * 60)
    if (rest === 60) return `${m + 1} m`
    return rest ? `${m} m ${rest} s` : `${m} m`
  }
  const h = s / 3600
  if (h < 48) return `${trim(h.toFixed(1))} h`
  const d = h / 24
  return `${trim(d < 10 ? d.toFixed(1) : d.toFixed(0))} d`
}

/** The same from seconds (database intervals, SLA settings). */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  return typeof seconds === 'number' ? formatDurationMs(seconds * 1000) : '—'
}

/** Signed difference against a baseline: `−2 ms`, `+1.4 s`, `0 ms`. */
export function formatDurationDelta(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : '−'}${formatDurationMs(Math.abs(ms))}`
}

const trim = (v: string) => v.replace(/\.0$/, '')
