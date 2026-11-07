'use client'

import { Fragment, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { Card, CardHeader } from '@/components/ui/card'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tag } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableSkeleton } from '@/components/ui/table'
import { plural } from '@/lib/format/plural'
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
    <Card padding="none" data-reporting-lines>
      <CardHeader
        title={<span className="flex items-center gap-2"><Network className="size-4 text-fg-muted" aria-hidden /> Reporting lines</span>}
        description="Who manages whom in this workspace. Managers see their reports’ tasks under Tasks → My team and can act on them on their behalf."
        actions={(
          <SearchInput size="sm" value={search} onValueChange={setSearch} placeholder="Find a member" aria-label="Find a member" wrapperClassName="w-full sm:w-64" />
        )}
        className="flex-wrap"
      />
      {error && <InlineNotice tone="danger" message={error} className="mx-4 mb-3" onDismiss={() => setError(null)} />}
      <Table bare containerClassName="border-t border-border-subtle">
        <THead>
          <tr>
            <TH>Member</TH>
            <TH>Manager</TH>
            <TH>Reports</TH>
          </tr>
        </THead>
        <TBody>
          {isLoading ? <TableSkeleton columns={3} rows={4} /> : filtered.length === 0 ? (
            <TableEmpty colSpan={3} variant={search ? 'no-results' : 'first-run'}
              title={search ? `No members match “${search}”` : 'No members yet'} />
          ) : filtered.map((line) => (
            <Fragment key={line.user_id}>
              <TR className="align-top" data-reporting-line={line.user_id}>
                <TD className="py-2">
                  <p className="font-medium text-fg">{line.display_name || line.email}</p>
                  {line.display_name && <p className="text-xs text-fg-muted">{line.email}</p>}
                </TD>
                <TD className="py-2">
                  {canEdit ? (
                    <Select
                      size="sm"
                      wrapperClassName="max-w-[14rem]"
                      aria-label={`Manager of ${line.display_name || line.email}`}
                      value={line.manager_user_id ?? ''}
                      disabled={busy === line.user_id}
                      onChange={(e) => void change(line.user_id, e.target.value)}
                    >
                      <option value="">No manager</option>
                      {lines.filter((l) => l.user_id !== line.user_id).map((l) => (
                        <option key={l.user_id} value={l.user_id}>{l.display_name || l.email}</option>
                      ))}
                    </Select>
                  ) : (
                    <span>{line.manager_user_id ? nameById.get(line.manager_user_id) : <span className="text-fg-subtle">—</span>}</span>
                  )}
                  {line.manager_source === 'directory' && (
                    <Tag className="mt-1">From directory sync</Tag>
                  )}
                </TD>
                <TD className="py-2">
                  {line.direct_reports > 0 ? (
                    <button type="button" aria-expanded={showReportsOf === line.user_id}
                      className="num text-ui font-medium text-primary-text underline-offset-2 hover:underline"
                      onClick={() => setShowReportsOf(showReportsOf === line.user_id ? null : line.user_id)}>
                      {plural(line.direct_reports, 'direct report')}
                    </button>
                  ) : <span className="text-fg-subtle">—</span>}
                  {showReportsOf === line.user_id && (
                    <ul className="mt-1 space-y-0.5 text-xs text-fg">
                      {lines.filter((l) => l.manager_user_id === line.user_id).map((l) => <li key={l.user_id}>{l.display_name || l.email}</li>)}
                    </ul>
                  )}
                </TD>
              </TR>
            </Fragment>
          ))}
        </TBody>
      </Table>
    </Card>
  )
}
