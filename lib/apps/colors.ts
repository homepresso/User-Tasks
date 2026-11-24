/**
 * App colours (pure; __tests__/apps-colors.test.ts): the categorical chart
 * palette and status colours every app widget uses — CSS variables defined
 * in components/apps/apps.css (vivid, light / dark aware, deferring to the
 * shared tag colour tokens when present).
 */

export const APP_CHART_COLORS = Array.from({ length: 8 }, (_, i) => `var(--app-chart-${i + 1})`)

/** completed = green, in progress / running = blue, to do = slate, waiting / blocked = amber, cancelled / failed / breached = rose. */
const STATUS_TONE: Record<string, 'done' | 'active' | 'idle' | 'waiting' | 'bad'> = {
  completed: 'done', done: 'done', on_track: 'done', success: 'done',
  in_progress: 'active', running: 'active', pending: 'active', open: 'active',
  todo: 'idle', draft: 'idle', none: 'idle',
  blocked: 'waiting', waiting: 'waiting', waiting_for_event: 'waiting', paused: 'waiting', at_risk: 'waiting', warning: 'waiting',
  cancelled: 'bad', canceled: 'bad', failed: 'bad', breached: 'bad', rejected: 'bad',
}

export function statusTone(status: string | null | undefined): 'done' | 'active' | 'idle' | 'waiting' | 'bad' | null {
  return STATUS_TONE[String(status ?? '').toLowerCase().replace(/[\s-]+/g, '_')] ?? null
}

export function statusColor(status: string | null | undefined): string | null {
  const tone = statusTone(status)
  return tone ? `var(--app-status-${tone})` : null
}

/** Colours for a chart's groups: status groups get their status colour, the rest the palette in order. */
export function groupColors(keys: readonly string[], byStatus: boolean, valueColors: Readonly<Record<string, string>> = {}): string[] {
  let next = 0
  // A widget style's value colours (lib/apps/style.ts) win, then status colours, then the palette in order.
  return keys.map((k) => valueColors[String(k).toLowerCase()] ?? (byStatus ? statusColor(k) : null) ?? APP_CHART_COLORS[next++ % APP_CHART_COLORS.length])
}

export const ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose', 'green'] as const
export type Accent = (typeof ACCENTS)[number]
export const ACCENT_VAR: Record<Accent, string> = { blue: 'var(--app-chart-1)', violet: 'var(--app-chart-2)', teal: 'var(--app-chart-3)', amber: 'var(--app-chart-4)', rose: 'var(--app-chart-5)', green: 'var(--app-chart-6)' }
