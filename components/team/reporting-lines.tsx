'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Network, Search } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { setMemberManager } from '@/app/actions/reporting-lines'

/**
 * Team page → Reporting lines: every member's manager in this workspace
 * (user_memberships.manager_user_id). Editable with team.change_roles;
 * lines synced from a directory are marked (the next sync overwrites them).
 */
export function ReportingLines({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['reporting-lines'],
    queryFn: () => serverQuery('settings.reportingLines'),
  })
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showReportsOf, setShowReportsOf] = useState<string | null>(null)

  const nameById = useMemo(() => new Map(lines.map((l) => [l.user_id, l.display_name || l.email || 'Unknown'])), [lines])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? lines.filter((l) => `${l.display_name ?? ''} ${l.email ?? ''}`.toLowerCase().includes(q)) : lines
  }, [lines, search])

  async function change(userId: string, managerId: string) {
    setBusy(userId)
    setError(null)
    const result = await setMemberManager(userId, managerId || null)
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    await queryClient.invalidateQueries({ queryKey: ['reporting-lines'] })
    await queryClient.invalidateQueries({ queryKey: ['is-manager'] })
  }

  return (
    <Card className="p-5" data-reporting-lines>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}><Network size={14} /> Reporting lines</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            Who manages whom in this workspace. Managers see their reports&apos; tasks under Tasks → My team and can act on them on their behalf.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a member" className="h-8 pl-8 text-xs" />
        </div>
      </div>
      {error && <p className="mb-2 text-xs" role="alert" style={{ color: 'var(--status-blocked)' }}>{error}</p>}
      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium">Manager</th>
                <th className="py-2 font-medium">Reports</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((line) => (
                <tr key={line.user_id} className="border-t align-top" style={{ borderColor: 'var(--theme-surface-border)' }} data-reporting-line={line.user_id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium" style={{ color: 'var(--theme-card-text)' }}>{line.display_name || line.email}</p>
                    {line.display_name && <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{line.email}</p>}
                  </td>
                  <td className="py-2 pr-3">
                    {canEdit ? (
                      <select
                        aria-label={`Manager of ${line.display_name || line.email}`}
                        value={line.manager_user_id ?? ''}
                        disabled={busy === line.user_id}
                        onChange={(e) => void change(line.user_id, e.target.value)}
                        className="h-8 max-w-[14rem] rounded-lg border px-2 text-xs"
                        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
                      >
                        <option value="">No manager</option>
                        {lines.filter((l) => l.user_id !== line.user_id).map((l) => (
                          <option key={l.user_id} value={l.user_id}>{l.display_name || l.email}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs">{line.manager_user_id ? nameById.get(line.manager_user_id) : '—'}</span>
                    )}
                    {line.manager_source === 'directory' && (
                      <p className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>From directory sync</p>
                    )}
                  </td>
                  <td className="py-2">
                    {line.direct_reports > 0 ? (
                      <button type="button" className="text-xs font-medium underline-offset-2 hover:underline" style={{ color: 'var(--theme-primary-text)' }}
                        onClick={() => setShowReportsOf(showReportsOf === line.user_id ? null : line.user_id)}>
                        {line.direct_reports} direct report{line.direct_reports === 1 ? '' : 's'}
                      </button>
                    ) : <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>—</span>}
                    {showReportsOf === line.user_id && (
                      <ul className="mt-1 space-y-0.5 text-xs" style={{ color: 'var(--theme-card-text)' }}>
                        {lines.filter((l) => l.manager_user_id === line.user_id).map((l) => <li key={l.user_id}>{l.display_name || l.email}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
