import type { WidgetData } from '@/lib/services/app-widgets'

/**
 * A widget's loaded data as rows for "Download CSV" in its header menu
 * (pure, client-safe; __tests__/apps-polish.test.ts). Only what the viewer
 * already sees — the rows the widget read as them — never a new query.
 */

type Row = Record<string, string | number | boolean | null>

const flat = (v: unknown): string | number | boolean | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((x) => flat(x)).filter((x) => x !== null && x !== '').join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return flat(o.label ?? o.name ?? o.display_name ?? o.title ?? o.email ?? o.value ?? null)
  }
  return String(v)
}

function flatten(list: ReadonlyArray<Record<string, unknown>>): Row[] {
  return list.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_') && k !== 'id' && !k.endsWith('_id')).map(([k, v]) => [k, flat(v)])))
}

export function widgetCsvRows(data: WidgetData | null | undefined): Row[] | null {
  if (!data) return null
  const d = data as Record<string, unknown> & { type: string }
  switch (d.type) {
    case 'task_list': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- task rows (lib/services/home.ts HomeTask)
      const tasks = (d.tasks ?? []) as Array<Record<string, any>>
      return tasks.map((t) => ({ title: t.title ?? '', status: t.status ?? '', priority: t.priority ?? '', due: t.due_date ?? '', overdue: !!t.overdue, process: t.process?.name ?? '', step: t.stage ?? '', team: t.team ?? '', tags: (t.tags ?? []).join(', ') }))
    }
    case 'chart': {
      const points = (d.points ?? []) as Array<{ label: string; value: number; values?: Record<string, number> }>
      const series = (d.series ?? []) as Array<{ key: string; label: string }>
      return points.map((p) => ({ group: p.label, [String(d.value_label ?? 'value')]: p.value, ...Object.fromEntries(series.map((s) => [s.label, p.values?.[s.key] ?? 0])) }))
    }
    case 'table_view': {
      if (d.kind !== 'data_table') return null
      const columns = (d.columns ?? []) as Array<{ key: string; label: string }>
      return ((d.rows ?? []) as Array<{ data: Record<string, unknown> }>).map((r) => Object.fromEntries(columns.map((c) => [c.label, flat(r.data[c.key])])))
    }
    case 'recent': return ((d.items ?? []) as Array<Record<string, unknown>>).map((i) => ({ title: flat(i.title), detail: flat(i.subtitle), status: flat(i.status), at: flat(i.at) }))
    case 'sla': return ((d.breakdown ?? []) as Array<Record<string, unknown>>).length
      ? flatten(d.breakdown as Array<Record<string, unknown>>)
      : [{ on_track: d.on_track as number, at_risk: d.at_risk as number, breached: d.breached as number, no_sla: d.no_sla as number }]
    case 'metric': return [{ value: (d.value as number | null) ?? null, previous: (d.previous as number | null) ?? null, change_pct: (d.change_pct as number | null) ?? null }]
    case 'empty': return null
  }
  // Other widgets: their first list of records (rows, items, people, columns of tasks).
  for (const key of ['rows', 'items', 'tasks', 'people', 'members', 'cards', 'records', 'points', 'buckets']) {
    const v = d[key]
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return flatten(v as Array<Record<string, unknown>>)
  }
  if (Array.isArray(d.columns) && (d.columns as unknown[]).some((c) => Array.isArray((c as { tasks?: unknown }).tasks))) {
    return (d.columns as Array<{ label: string; tasks: Array<Record<string, unknown>> }>).flatMap((c) => c.tasks.map((t) => ({ column: c.label, title: flat(t.title), due: flat(t.due_date) })))
  }
  return null
}
