'use client'

/**
 * Agent designer → Tools → Data tables: explicit per-table grants (read /
 * insert / update / delete). New agents have none. An agent that still has
 * the legacy "all tables" access shows a banner suggesting it be narrowed;
 * "Switch to per-table grants" lists every table with the access it has
 * today (read / insert / update) so the author can untick what it does not
 * need.
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { plural } from '@/lib/format/plural'
import type { AgentTableGrant, AgentTableOperation } from '@/lib/agent-knowledge'

export interface DataAccessValue {
  mode: 'none' | 'selected' | 'all'
  table_ids: string[]
  grants: AgentTableGrant[]
  legacy?: boolean
}

const OPS: { op: AgentTableOperation; label: string; title: string }[] = [
  { op: 'read', label: 'Read', title: 'query_data_table: read rows' },
  { op: 'insert', label: 'Insert', title: 'insert_data_row: add rows' },
  { op: 'update', label: 'Update', title: 'update_data_rows: change matching rows (at most 100 per call)' },
  { op: 'delete', label: 'Delete', title: 'delete_data_rows: delete matching rows (at most 100 per call)' },
]

export function dataAccessFromGrants(grants: AgentTableGrant[]): DataAccessValue {
  const kept = grants.filter((g) => g.read || g.insert || g.update || g.delete)
  return kept.length ? { mode: 'selected', table_ids: kept.map((g) => g.table_id), grants: kept } : { mode: 'none', table_ids: [], grants: [] }
}

/** Short summary for badges ("Data: none", "Data: 2 tables", "Data: all tables (legacy)"). */
export function dataAccessSummary(access: DataAccessValue | undefined): string {
  if (!access || access.mode === 'none') return 'No data tables'
  if (access.mode === 'all') return 'All tables (legacy)'
  return plural(access.grants.length, 'table')
}

export function DataGrantsPanel({ value, tables, onChange }: {
  value: DataAccessValue | undefined
  tables: { id: string; name: string; description?: string | null }[]
  onChange: (next: DataAccessValue) => void
}) {
  const [search, setSearch] = useState('')
  const access: DataAccessValue = value ?? { mode: 'none', table_ids: [], grants: [] }
  const grants = access.mode === 'selected' ? access.grants : []
  const byId = useMemo(() => new Map(grants.map((g) => [g.table_id, g])), [grants])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const granted = tables.filter((t) => byId.has(t.id))
    const rest = tables.filter((t) => !byId.has(t.id) && (!q || `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q)))
    return [...granted, ...(q ? rest : rest.slice(0, 8))]
  }, [tables, byId, search])

  const setOp = (tableId: string, op: AgentTableOperation, on: boolean) => {
    const current = byId.get(tableId) ?? { table_id: tableId, read: false, insert: false, update: false, delete: false }
    const next = { ...current, [op]: on }
    // Writing without reading is allowed, but ticking a write also ticks Read (the usual need).
    if (on && op !== 'read' && !byId.has(tableId)) next.read = true
    const list = byId.has(tableId) ? grants.map((g) => (g.table_id === tableId ? next : g)) : [...grants, next]
    onChange(dataAccessFromGrants(list))
  }

  if (access.mode === 'all') {
    return (
      <div className="space-y-2" data-testid="agent-data-grants">
        <div data-testid="agent-broad-access-banner">
          <InlineNotice
            tone="warning"
            title="This agent can read, add and update rows in every data table of this workspace."
            message={<span className="text-fg-muted">It kept the access it had before per-table grants existed. New agents start with no table access — narrow this one to the tables (and operations) it needs.</span>}
          >
            <Button type="button" size="sm" variant="secondary" className="mt-2"
              onClick={() => onChange(dataAccessFromGrants(tables.map((t) => ({ table_id: t.id, read: true, insert: true, update: true, delete: false }))))}>
              Switch to per-table grants
            </Button>
          </InlineNotice>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="agent-data-grants">
      <div className="flex items-center justify-between gap-2">
        <span className="num text-xs text-fg-muted">
          {grants.length === 0 ? 'No table access — the agent gets no data tools.' : `${plural(grants.length, 'table')} granted`}
        </span>
        {grants.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ mode: 'none', table_ids: [], grants: [] })}>Remove all</Button>
        )}
      </div>
      <SearchInput size="sm" value={search} onValueChange={setSearch} placeholder="Search tables to grant…" aria-label="Search data tables" />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-panel">
        <table className="w-full text-ui">
          <thead>
            <tr className="bg-subtle text-xs text-fg-muted">
              <th className="px-2 py-1.5 text-left font-medium">Table</th>
              {OPS.map((o) => <th key={o.op} className="w-16 px-1 py-1.5 text-center font-medium" title={o.title}>{o.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const g = byId.get(t.id)
              return (
                <tr key={t.id} className="border-t border-border-subtle hover:bg-subtle">
                  <td className="max-w-0 px-2 py-1.5">
                    <span className="block truncate text-fg">{t.name}</span>
                  </td>
                  {OPS.map((o) => (
                    <td key={o.op} className="text-center">
                      <Checkbox aria-label={`${o.label} ${t.name}`} checked={Boolean(g?.[o.op])} onChange={(e) => setOp(t.id, o.op, e.target.checked)} className="align-middle" />
                    </td>
                  ))}
                </tr>
              )
            })}
            {tables.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-xs text-fg-muted">No data tables in this workspace yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">With an acting person, reads also need their data.view permission and writes data.manage_rows. Update and delete touch at most 100 matching rows per call; consider requiring approval for them (Settings → Approvals).</p>
    </div>
  )
}
