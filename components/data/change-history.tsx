'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { InlineNotice } from '@/components/ui/inline-notice'
import { serverRead } from '@/lib/server-read'
import { saveTableAudit } from '@/app/actions/data-grid'
import { formatDateTime } from '@/lib/format/date'
import { auditValueText } from '@/lib/data-table-audit-format'

/**
 * Field-change history of data tables (lib/services/data-table-audit.ts):
 * the table designer's on / off switch and a row's history list (row drawer,
 * app record cards).
 */

/** Table designer: record every field change of every row. */
export function TableAuditSwitch({ tableId }: { tableId: string }) {
  const client = useQueryClient()
  const key = ['data-table-audit', tableId]
  const { data } = useQuery({ queryKey: key, queryFn: async () => (await serverRead('data.tableAudit', { tableId })).data ?? { available: false, audited: false } })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!data) return null
  return (
    <section className="mt-6 space-y-2" aria-labelledby={`audit-${tableId}`}>
      <h3 id={`audit-${tableId}`} className="flex items-center gap-1.5 text-sm font-semibold text-fg"><History className="size-4" aria-hidden />Change history</h3>
      {data.available ? (
        <Switch checked={data.audited} disabled={saving} label="Record every field change of every row (who, when, old and new value)" data-table-audit-switch
          onCheckedChange={async (on) => {
            setSaving(true); setError(null)
            const r = await saveTableAudit(tableId, on)
            setSaving(false)
            if (!r.ok) { setError(r.error); return }
            client.setQueryData(key, { available: true, audited: r.data.audited })
          }} />
      ) : <InlineNotice tone="info" message="Change history needs database migration 20270128090000: ask an administrator to apply it." />}
      <p className="text-xs text-fg-muted">Changes from the grid, forms, the API and workflows are all recorded. A row’s history is deleted with the row, so retention policies cover it too.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  )
}

export interface RowChangeView { field: string; label: string; old_value: unknown; new_value: unknown; changed_by: string | null; changed_by_name: string | null; changed_at: string }

/** A row's changes, newest first (empty, or nothing at all when the table records none). */
export function RowChangeList({ changes, empty = 'No changes recorded yet.' }: { changes: readonly RowChangeView[]; empty?: string }) {
  if (!changes.length) return <p className="text-xs text-fg-muted">{empty}</p>
  return (
    <ol className="space-y-1.5" data-row-changes>
      {changes.map((c, i) => (
        <li key={i} className="text-xs">
          <p className="text-fg"><span className="font-medium">{c.label}</span>: <span className="text-fg-muted line-through">{auditValueText(c.old_value)}</span> → <span>{auditValueText(c.new_value)}</span></p>
          <p className="text-fg-subtle">{c.changed_by_name ?? (c.changed_by ? 'Someone' : 'Automation')} · {formatDateTime(c.changed_at)}</p>
        </li>
      ))}
    </ol>
  )
}

/** Row drawer: the row's history (only for tables that record changes). */
export function RowChangeHistory({ tableId, rowId }: { tableId: string; rowId: string }) {
  const { data } = useQuery({ queryKey: ['data-row-changes', tableId, rowId], queryFn: async () => (await serverRead('data.rowChanges', { tableId, rowId })).data, staleTime: 15_000 })
  if (!data?.available || (!data.audited && !data.changes.length)) return null
  return (
    <section className="space-y-2 border-t border-border-subtle pt-3" aria-label="Change history">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg"><History className="size-4" aria-hidden />Change history</h3>
      <RowChangeList changes={data.changes} />
    </section>
  )
}
