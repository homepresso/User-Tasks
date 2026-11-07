'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { unwrapAction } from '@/lib/action-result'
import { listAuditActivity } from '@/app/actions/activity'
import { usePermissions } from '@/lib/permissions-context'
import { AUDIT_ACTION_LABELS, AUDIT_OBJECT_TYPE_LABELS, auditActionLabel, auditObjectTypeLabel } from '@/lib/audit-labels'
import { hrefForObject } from '@/components/activity/activity-feed'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const PAGE_SIZE = 50
const selectStyle = { borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }

/**
 * Settings → Governance → Audit Log: changes to governed objects
 * (object_audit_log), filterable by object type and action — forms' create,
 * update, availability toggles, grants, retention, purges, legal holds and
 * deletes among them. The same feed as /activity (settings.view).
 */
export function ObjectAuditLog({ initialType = '' }: { initialType?: string }) {
  const { can } = usePermissions()
  const [objectType, setObjectType] = useState(initialType)
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['governance-object-audit', objectType, action, page],
    queryFn: async () => unwrapAction(await listAuditActivity({ objectType: objectType || null, action: action || null, page })),
    enabled: can('settings.view'),
  })
  const rows = (data?.rows ?? []) as Array<Record<string, any>>
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <section className="space-y-3" aria-labelledby="object-audit-heading" data-testid="governance-object-audit">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h2 id="object-audit-heading" className="text-lg font-semibold text-fg">Object changes</h2>
          <p className="text-xs mt-1 text-fg-muted">Who changed which workflow, form, data table and other governed object, and when — including access grants, retention, purges and legal holds.</p>
        </div>
        <label className="text-xs text-fg-muted">
          <span className="block mb-1">Object type</span>
          <select aria-label="Object type" value={objectType} onChange={(e) => { setObjectType(e.target.value); setPage(0) }} className="h-9 rounded-lg border px-3 text-xs" style={selectStyle} data-testid="audit-object-type">
            <option value="">All object types</option>
            {Object.entries(AUDIT_OBJECT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs text-fg-muted">
          <span className="block mb-1">Action</span>
          <select aria-label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(0) }} className="h-9 rounded-lg border px-3 text-xs" style={selectStyle}>
            <option value="">All actions</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border overflow-hidden border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--theme-surface)' }}>
                {['Object', 'Action', 'Summary', 'Actor', 'When'].map((h) => (
                  <th key={h} className={`px-4 py-2.5 text-xs font-semibold ${h === 'When' ? 'text-right' : 'text-left'}`} style={{ color: 'var(--theme-muted-text)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!can('settings.view') ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-fg-muted">Viewing object changes needs View settings.</td></tr>
              ) : isLoading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-fg-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-fg-muted">No changes match these filters</td></tr>
              ) : rows.map((row) => {
                const href = hrefForObject(String(row.object_type), String(row.object_id), row.metadata ?? undefined)
                return (
                  <tr key={row.id} className="border-t border-border bg-panel" data-testid="audit-row">
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-fg">{auditObjectTypeLabel(String(row.object_type))}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap font-medium text-fg">{auditActionLabel(String(row.action))}</td>
                    <td className="px-4 py-2.5 text-xs text-fg-muted">
                      {href ? <Link href={href} className="hover:underline">{row.summary ?? row.object_id}</Link> : (row.summary ?? row.object_id)}
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-fg">{row.actor?.display_name ?? (row.actor_id ? '—' : 'System')}</td>
                    <td className="px-4 py-2.5 text-xs text-right whitespace-nowrap text-fg-muted">
                      {new Date(row.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>Page {page + 1} of {totalPages} · {data?.total ?? 0} changes</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </section>
  )
}
