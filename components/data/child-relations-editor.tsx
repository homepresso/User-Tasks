'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { serverRead } from '@/lib/server-read'
import { saveChildRelations } from '@/app/actions/data-grid'
import { GROUPING_LIMITS, lookupColumnsTo, newRelationId, type ChildRelation } from '@/lib/grid/grouping'

type TableRef = { id: string; name: string; columns: unknown }

/**
 * Table designer → Child records: "rows of <table> linked by <lookup
 * column>", up to five relations. A relation's lookup column must be a
 * lookup column of the child table whose source is this table; choosing
 * this table itself makes a hierarchy (optionally listing only top-level
 * rows in the grid). Saved on its own (the server checks every relation).
 */
export function ChildRelationsEditor({ tableId }: { tableId: string }) {
  const queryClient = useQueryClient()
  const { data: tables = [] } = useQuery({
    queryKey: ['custom-tables-for-lookups'],
    queryFn: async () => ((await serverRead('data.lookupTables')).data ?? []) as TableRef[],
  })
  const { data: stored } = useQuery({
    queryKey: ['data-child-relations', tableId],
    queryFn: async () => ((await serverRead('data.childRelations', { tableId })).data ?? { relations: [], available: false }) as { relations: ChildRelation[]; available: boolean },
  })
  const [draft, setDraft] = useState<ChildRelation[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  useEffect(() => { if (stored) setDraft(stored.relations) }, [stored])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(stored?.relations ?? []), [draft, stored])

  const choicesFor = (childTableId: string) => {
    const table = tables.find((t) => t.id === childTableId)
    return table ? lookupColumnsTo(tableId, table) : []
  }
  const patch = (id: string, p: Partial<ChildRelation>) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...p } : r)))

  function add() {
    // Start from the first table with a lookup column pointing here (this table last: a hierarchy is the rarer case).
    const ordered = [...tables.filter((t) => t.id !== tableId), ...tables.filter((t) => t.id === tableId)]
    const first = ordered.find((t) => lookupColumnsTo(tableId, t).length > 0)
    const column = first ? lookupColumnsTo(tableId, first)[0] : undefined
    setDraft((d) => [...d, { id: newRelationId(), table_id: first?.id ?? '', lookup_column: column?.key ?? '' }])
  }

  async function save() {
    setSaving(true); setError(null)
    const res = await saveChildRelations(tableId, draft.filter((r) => r.table_id && r.lookup_column))
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    setSavedAt(Date.now())
    await queryClient.invalidateQueries({ queryKey: ['data-child-relations', tableId] })
    queryClient.invalidateQueries({ queryKey: ['data-child-counts'] })
  }

  return (
    <section className="space-y-3 border-t border-border-subtle pt-6" data-testid="child-relations-editor">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-fg"><GitBranch className="size-4 text-fg-muted" aria-hidden /> Child records</h2>
          <p className="mt-0.5 text-ui text-fg-muted">
            Show related rows under each row of this table, expandable in the grid. A child table links to this one with a <strong>Lookup</strong> column whose source is this table; pick this table itself for a hierarchy (for example a Parent task column).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <Button variant="ghost" size="sm" onClick={() => setDraft(stored?.relations ?? [])} disabled={saving}>Discard</Button>}
          <Button variant="secondary" size="sm" leadingIcon={<Plus />} onClick={add} disabled={draft.length >= GROUPING_LIMITS.relations || stored?.available === false}>Add child records</Button>
          <Button size="sm" onClick={save} disabled={!dirty || stored?.available === false} loading={saving} data-testid="child-relations-save">Save child records</Button>
        </div>
      </div>
      {stored?.available === false && (
        <InlineNotice tone="warning" message="Child records need database migration 20270119090000_data_table_grouping — ask an administrator to apply it." />
      )}
      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      {savedAt && !dirty && !error && <p className="text-xs text-fg-muted" role="status">Saved. Rows of this table now show their child records.</p>}
      {draft.length === 0 ? (
        <p className="text-xs text-fg-muted">No child records. Add a relation to show, for example, the order lines under each order.</p>
      ) : (
        <div className="space-y-2">
          {draft.map((rel) => {
            const choices = choicesFor(rel.table_id)
            const same = rel.table_id === tableId
            return (
              <div key={rel.id} className="grid items-center gap-2 rounded-md border border-border p-2 md:grid-cols-[1.2fr_1.2fr_1fr_auto]" data-child-relation={rel.id}>
                <Select size="sm" aria-label="Child table" value={rel.table_id}
                  onChange={(e) => { const next = e.target.value; const first = choicesFor(next)[0]; patch(rel.id, { table_id: next, lookup_column: first?.key ?? '', roots_only: next === tableId ? rel.roots_only : undefined }) }}
                  placeholder="Child table…"
                  options={tables.map((t) => ({ value: t.id, label: t.id === tableId ? `${t.name} (this table — hierarchy)` : t.name }))} />
                <Select size="sm" aria-label="Linked by lookup column" value={rel.lookup_column} disabled={!rel.table_id}
                  onChange={(e) => patch(rel.id, { lookup_column: e.target.value })}
                  placeholder={rel.table_id && !choices.length ? 'No lookup column points here' : 'Linked by…'}
                  options={choices.map((c) => ({ value: c.key, label: `linked by ${c.name}` }))} />
                <Input size="sm" aria-label="Label" placeholder="Label (optional)" value={rel.label ?? ''} maxLength={GROUPING_LIMITS.label}
                  onChange={(e) => patch(rel.id, { label: e.target.value || undefined })} />
                <IconButton size="sm" variant="danger-ghost" label="Remove child records" icon={<Trash2 />} onClick={() => setDraft((d) => d.filter((r) => r.id !== rel.id))} />
                {same && (
                  <div className="md:col-span-4">
                    <Checkbox checked={rel.roots_only === true} onChange={(e) => patch(rel.id, { roots_only: e.target.checked || undefined })}
                      label="Only list top-level rows in the grid (rows with a parent show under it)" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
