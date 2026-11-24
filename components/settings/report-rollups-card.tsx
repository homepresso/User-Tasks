import Link from 'next/link'
import { Database } from 'lucide-react'
import { InlineNotice } from '@/components/ui/inline-notice'
import { TableScroll } from '@/components/ui/table'
import type { RollupStatus } from '@/lib/services/report-rollups'

/**
 * Settings → Infrastructure → Report rollups (instance admins): backfill
 * progress per workspace, queued rebuilds, last rebuild / reconcile. Read
 * only; workspace admins run Rebuild / Backfill from Settings → Query, and
 * operators use `usertasks-admin rollups`.
 */

const muted = { color: 'var(--theme-muted-text)' }
const when = (iso: string | null | undefined) => {
  if (!iso || iso.startsWith('-')) return 'never'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return min < 120 ? `${min} min ago` : min < 2880 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`
}

export function ReportRollupsCard({ status, error }: { status: RollupStatus | null; error: string | null }) {
  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)' }} data-report-rollups-card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Database size={16} /> Report rollups</h2>
        <Link href="/docs/self-hosting/query-settings" className="text-xs underline underline-offset-2">Docs</Link>
      </div>
      {error && <InlineNotice tone="warning" message={`Status unavailable: ${error}`} />}
      {!error && !status && <InlineNotice tone="info" message="Not installed on this database yet (migration 20270123100000). Every report reads real time." />}
      {status && (
        <>
          <p className="text-sm">
            {status.backfilled} of {status.tenants} workspaces backfilled{status.in_progress ? `, ${status.in_progress} in progress` : ''}{status.not_started ? `, ${status.not_started} not started` : ''}
            {' · '}{status.dirty_ranges} queued rebuild{status.dirty_ranges === 1 ? '' : 's'}
            {' · '}last rebuild {when(status.last_refresh_at)} · oldest reconcile {when(status.oldest_reconciled_at)} · newest update {when(status.newest_delta_at)}
          </p>
          <p className="text-xs" style={muted}>Rows: runs ~{status.rows.runs.toLocaleString('en-US')}, nodes ~{status.rows.nodes.toLocaleString('en-US')}, tasks ~{status.rows.tasks.toLocaleString('en-US')}, submissions ~{status.rows.submissions.toLocaleString('en-US')}. Maintained by the scheduler&apos;s report-rollups job; <code>usertasks-admin rollups backfill</code> runs the backfill now.</p>
          {status.tenants_detail.length > 0 && (
            <TableScroll>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs" style={muted}><th className="py-1 pr-2">Workspace</th><th className="pr-2">Coverage</th><th className="pr-2">Last rebuild</th><th>Last reconcile</th></tr></thead>
                <tbody>
                  {status.tenants_detail.map((t) => (
                    <tr key={t.tenant_id} className="border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
                      <td className="py-1 pr-2">{t.name}</td>
                      <td className="pr-2">{t.done ? 'every day' : `from ${t.covered_from ?? '—'} (back to ${t.oldest_day ?? '—'})`}</td>
                      <td className="pr-2">{when(t.last_refresh_at)}</td>
                      <td>{when(t.last_reconciled_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </>
      )}
    </section>
  )
}
